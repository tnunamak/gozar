//! Bounded operational plans. Adapter schema knowledge stays in data, outside this module.
use super::*;

pub const FEATURES: &[&str] = &[
    "recipe-sequence",
    "typed-bindings",
    "predicate-parser",
    "owned-resource-ledger",
    "owned-process",
    "interface-forwarder",
    "private-file-reference",
    "probe-assertions",
    "client-vantage-probe",
    "unused-port-selection",
];
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Host {
    #[serde(default)]
    pub now_ms: u64,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default)]
    pub bindings: BTreeMap<String, Value>,
    #[serde(default)]
    pub facts: BTreeMap<String, Value>,
    #[serde(default)]
    pub probe: Option<Value>,
    #[serde(default)]
    pub cleanup_absent: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ledger {
    pub handle_ref: String,
    pub continuity_ref: String,
    pub kind: String,
    pub details: Value,
    pub baseline: Value,
    pub bindings: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub stage: String,
    pub step_id: String,
    pub execution_generation: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanStep {
    id: String,
    recipe: Recipe,
    #[serde(default)]
    captures: BTreeMap<String, Value>,
    #[serde(default)]
    assert: Option<Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Execution {
    adapter_id: String,
    operation: String,
    resource_id: Option<String>,
    generation: u64,
    recipe: Recipe,
    before: Vec<PlanStep>,
    after: Vec<PlanStep>,
    requires: Vec<Value>,
    stage: String,
    index: usize,
    facts: BTreeMap<String, Value>,
    bindings: BTreeMap<String, Value>,
    started_at_ms: u64,
    valid_until_ms: u64,
    candidate: Option<String>,
    ledger: Option<Ledger>,
    ownership_receipt: Option<Value>,
}
fn fail(out: &mut Output, message: &str) {
    limit(out, message);
    event(out, "plan-blocked");
    out.state.phase = if out.state.stop_requested
        || out
            .state
            .resources
            .iter()
            .any(|r| r.ledger.is_some() && r.cleanup != "removed")
    {
        "cleanup-pending"
    } else {
        "failed"
    }
    .into();
    out.state.execution = None;
}
fn fresh(receipt: &Value, state: &State) -> bool {
    receipt.get("sessionId").and_then(Value::as_str) == Some(&state.session_id)
        && receipt
            .get("observedAtMs")
            .and_then(Value::as_u64)
            .is_some_and(|t| t <= state.host.now_ms)
        && receipt
            .get("expiresAtMs")
            .and_then(Value::as_u64)
            .is_some_and(|t| t > state.host.now_ms)
}
fn opaque(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 512
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.:/".contains(c))
}
fn dns(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 253
        && s.split('.').all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && !l.starts_with('-')
                && !l.ends_with('-')
                && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
}
fn typed(kind: &str, value: &Value) -> bool {
    match kind {
        "bool" => value.is_boolean(),
        "port" | "loopback-port" | "unused-port" => {
            value.as_u64().is_some_and(|n| n > 0 && n <= 65535)
        }
        "reserved-unused-port" => value.as_u64().is_some_and(|n| n <= 65535),
        "literal" => {
            value.is_boolean()
                || value.as_u64().is_some()
                || value.as_str().is_some_and(|s| {
                    s.len() <= 512
                        && !s.is_empty()
                        && s.chars()
                            .all(|c| c.is_ascii_alphanumeric() || "-_.:/".contains(c))
                })
        }
        "mount" => value.as_str().is_some_and(|s| {
            s.starts_with('/')
                && s.len() <= 128
                && !s.contains("..")
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_/".contains(c))
        }),
        "dns-name" => value.as_str().is_some_and(dns),
        "opaque-ref" | "opaque-private-reference" | "resource-handle" => {
            value.as_str().is_some_and(opaque)
        }
        "origin" => value
            .as_str()
            .is_some_and(|s| origin(s).as_deref() == Some(s)),
        "credential-free-https-origin" => value
            .as_str()
            .is_some_and(|s| s.starts_with("https://") && origin(s).as_deref() == Some(s)),
        "loopback-http-origin" => value.as_str().is_some_and(|s| {
            origin(s).as_deref() == Some(s)
                && s.strip_prefix("http://")
                    .is_some_and(|a| a.starts_with("127.0.0.1:") || a.starts_with("[::1]:"))
        }),
        "selected-interface-address" => value
            .as_str()
            .and_then(|s| s.parse::<std::net::IpAddr>().ok())
            .is_some_and(|a| {
                !a.is_loopback()
                    && !a.is_unspecified()
                    && !a.is_multicast()
                    && match a {
                        std::net::IpAddr::V4(v) => !v.is_link_local(),
                        std::net::IpAddr::V6(v) => !v.is_unicast_link_local(),
                    }
            }),
        _ => false,
    }
}
fn binding_value(binding: &Value) -> Option<&Value> {
    binding.get("value").or_else(|| binding.get("handleRef"))
}
fn expand(value: &Value, bindings: &BTreeMap<String, Value>) -> Result<Value, String> {
    match value {
        Value::String(s) => {
            if let Some(name) = s.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
                if !name.contains(['{', '}']) {
                    if bindings
                        .get(name)
                        .is_some_and(|b| str_field(b, "type") == "session-private-path")
                    {
                        return Ok(json!(s));
                    }
                    return bindings
                        .get(name)
                        .and_then(binding_value)
                        .cloned()
                        .ok_or_else(|| format!("Unresolved typed binding: {name}"));
                }
            }
            let mut text = s.clone();
            for (name, binding) in bindings {
                if str_field(binding, "type") == "session-private-path" {
                    continue;
                }
                let v = binding_value(binding).ok_or("Missing binding value")?;
                let replacement = v
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| v.to_string());
                text = text.replace(&format!("{{{name}}}"), &replacement);
            }
            // Private placeholders remain only in executable fields for driver resolution.
            let private_removed = bindings
                .iter()
                .filter(|(_, v)| str_field(v, "type") == "session-private-path")
                .fold(text.clone(), |s, (name, _)| {
                    s.replace(&format!("{{{name}}}"), "")
                });
            if private_removed.contains(['{', '}']) || text.contains('\0') {
                return Err("Unknown or malformed template binding".into());
            }
            Ok(json!(text))
        }
        Value::Array(values) => values
            .iter()
            .map(|v| expand(v, bindings))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Value::Object(values) => values
            .iter()
            .map(|(k, v)| Ok((k.clone(), expand(v, bindings)?)))
            .collect::<Result<serde_json::Map<_, _>, String>>()
            .map(Value::Object),
        _ => Ok(value.clone()),
    }
}
fn pointer_text(pointer: &str, bindings: &BTreeMap<String, Value>) -> Result<String, String> {
    let mut text = pointer.to_owned();
    for (name, value) in bindings {
        if let Some(value) = binding_value(value) {
            let s = value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string());
            text = text.replace(
                &format!("{{{name}}}"),
                &s.replace('~', "~0").replace('/', "~1"),
            );
        }
    }
    if text.contains(['{', '}']) {
        return Err("Unresolved pointer binding".into());
    }
    Ok(text)
}
fn source<'a>(facts: &'a BTreeMap<String, Value>, name: &str) -> Option<&'a Value> {
    facts.get(name)
}
fn resolve_bindings(
    a: &Adapter,
    e: &mut Execution,
    state: &State,
    all: bool,
) -> Result<(), String> {
    let Some(specs) = a.bindings.as_ref().and_then(Value::as_object) else {
        return Ok(());
    };
    if specs.len() > 32 {
        return Err("Too many typed bindings".into());
    }
    for (name, spec) in specs {
        if !opaque(name) {
            return Err("Invalid binding name".into());
        }
        if e.bindings.contains_key(name) {
            continue;
        }
        let kind = str_field(spec, "type");
        let mut authority = format!("plan:{}:{name}", e.generation);
        let value = if kind == "literal" {
            spec.get("value").cloned()
        } else if kind == "unused-port" {
            let values = source(&e.facts, str_field(spec, "source"))
                .and_then(|v| v.pointer(str_field(spec, "pointer")))
                .and_then(Value::as_array);
            if let Some(occupied) = values {
                let candidates = spec
                    .get("candidates")
                    .and_then(Value::as_array)
                    .ok_or("Unused port needs explicit candidates")?;
                let protected = spec
                    .get("protectedPorts")
                    .and_then(Value::as_array)
                    .ok_or("Unused port needs protected list")?;
                if candidates.len() > 128 || occupied.iter().any(|p| !typed("port", p)) {
                    return Err("Invalid occupied port facts".into());
                }
                Some(
                    candidates
                        .iter()
                        .find(|p| {
                            typed("port", p) && !protected.contains(p) && !occupied.contains(p)
                        })
                        .cloned()
                        .ok_or("All explicit listener candidates are occupied or protected")?,
                )
            } else {
                None
            }
        } else if let Some(v) = spec.get("value") {
            Some(v.clone())
        } else if let Some(step) = spec
            .get("source")
            .and_then(Value::as_str)
            .filter(|_| spec.get("pointer").is_some())
        {
            source(&e.facts, step)
                .and_then(|v| v.pointer(str_field(spec, "pointer")))
                .cloned()
        } else if let Some(binding) = state.host.bindings.get(name) {
            if str_field(binding, "type") != kind
                || !fresh(binding, state)
                || !opaque(str_field(binding, "authorityRef"))
            {
                return Err("Binding authority missing, stale, or wrong type".into());
            }
            if kind == "session-private-path" {
                if !opaque(str_field(binding, "handleRef"))
                    || str_field(binding, "mode") != "0600"
                    || str_field(binding, "parentMode") != "0700"
                {
                    return Err("Private handle lacks session-only permissions".into());
                }
                e.valid_until_ms = e
                    .valid_until_ms
                    .min(binding["expiresAtMs"].as_u64().unwrap_or(0));
                let mut saved = binding.clone();
                saved["hostAuthority"] = binding["authorityRef"].clone();
                e.bindings.insert(name.clone(), saved);
                continue;
            }
            authority = str_field(binding, "authorityRef").into();
            e.valid_until_ms = e
                .valid_until_ms
                .min(binding["expiresAtMs"].as_u64().unwrap_or(0));
            binding.get("value").cloned()
        } else {
            None
        };
        if let Some(mut value) = value {
            if kind == "dns-name" && spec.get("trimTrailingDot") == Some(&Value::Bool(true)) {
                if let Some(s) = value.as_str() {
                    value = json!(s.trim_end_matches('.'));
                }
            }
            if !typed(kind, &value) {
                return Err(format!("Invalid typed binding {name}"));
            }
            let mut binding = json!({"type":kind,"value":value,"authorityRef":authority});
            if state
                .host
                .bindings
                .get(name)
                .is_some_and(|b| str_field(b, "authorityRef") == authority)
            {
                binding["hostAuthority"] = json!(authority);
            }
            e.bindings.insert(name.clone(), binding);
        } else if all {
            return Err(format!("Missing typed binding {name}"));
        }
    }
    Ok(())
}
fn port_maps_at<'a>(document: &'a Value, pointer: &str) -> Result<Vec<&'a Value>, String> {
    if pointer.is_empty() {
        return Ok(vec![document]);
    }
    if !pointer.starts_with('/') {
        return Err("Port map pointer must be absolute".into());
    }
    let mut values = vec![document];
    for token in pointer[1..].split('/') {
        let key = token.replace("~1", "/").replace("~0", "~");
        let mut next = vec![];
        for value in values {
            match value {
                Value::Object(o) => {
                    if key == "*" {
                        next.extend(o.values());
                    } else if let Some(v) = o.get(&key) {
                        next.push(v);
                    }
                }
                Value::Array(a) => {
                    if key == "*" {
                        next.extend(a);
                    } else if let Some(v) = key.parse::<usize>().ok().and_then(|i| a.get(i)) {
                        next.push(v);
                    }
                }
                _ => return Err("Unknown intermediate listener map schema".into()),
            }
        }
        values = next;
    }
    Ok(values)
}
fn port_key(key: &str) -> Option<u64> {
    key.parse()
        .ok()
        .or_else(|| key.rsplit_once(':').and_then(|(_, p)| p.parse().ok()))
        .filter(|n| *n > 0 && *n <= 65535)
}
fn capture(
    doc: &Value,
    spec: &Value,
    bindings: &BTreeMap<String, Value>,
    depth: usize,
) -> Result<Value, String> {
    if depth > 12 {
        return Err("Capture nesting exceeded".into());
    }
    let kind = str_field(spec, "type");
    if kind == "port-set" {
        let paths = spec
            .get("paths")
            .and_then(Value::as_array)
            .ok_or("Port capture needs map paths")?;
        if !doc.is_object() || paths.is_empty() || paths.len() > 32 {
            return Err("Invalid port map capture".into());
        }
        let mut ports = std::collections::BTreeSet::new();
        for path in paths {
            let path = pointer_text(path.as_str().ok_or("Invalid map pointer")?, bindings)?;
            for map in port_maps_at(doc, &path)? {
                let map = map.as_object().ok_or("Port map has unknown schema")?;
                for key in map.keys() {
                    ports.insert(port_key(key).ok_or("Unknown listener key format")?);
                }
            }
        }
        return Ok(json!(ports));
    }
    let pointer = pointer_text(str_field(spec, "pointer"), bindings)?;
    let values = values_at(doc, &pointer);
    if values.is_empty() && spec.get("optional") == Some(&Value::Bool(true)) {
        return Ok(Value::Null);
    }
    if values.len() != 1 {
        return Err("Typed capture needs exactly one matching value".into());
    }
    let selected = values[0];
    if kind == "record" {
        let fields = spec
            .get("fields")
            .and_then(Value::as_object)
            .ok_or("Record capture needs explicit fields")?;
        if fields.len() > 32 {
            return Err("Capture record too wide".into());
        }
        let mut result = serde_json::Map::new();
        for (name, field) in fields {
            result.insert(name.clone(), capture(selected, field, bindings, depth + 1)?);
        }
        return Ok(Value::Object(result));
    }
    let mut value = selected.clone();
    if kind == "dns-name" && spec.get("trimTrailingDot") == Some(&Value::Bool(true)) {
        if let Some(s) = value.as_str() {
            value = json!(s.trim_end_matches('.'));
        }
    }
    if !typed(kind, &value) {
        return Err("Captured value does not match nonsecret type".into());
    }
    Ok(value)
}
fn continuity(receipt: &Value, ledger: &Ledger, state: &State) -> bool {
    fresh(receipt, state)
        && receipt.get("continuous") == Some(&Value::Bool(true))
        && str_field(receipt, "handleRef") == ledger.handle_ref
        && str_field(receipt, "continuityRef") == ledger.continuity_ref
}
fn assertion(
    rule: &Value,
    doc: &Value,
    e: &Execution,
    state: &State,
    result: &Value,
    depth: usize,
) -> bool {
    if depth > 32 {
        return false;
    }
    let raw_op = str_field(rule, "op");
    if raw_op == "all" {
        return rule
            .get("rules")
            .or_else(|| rule.get("items"))
            .and_then(Value::as_array)
            .is_some_and(|r| {
                r.iter()
                    .all(|r| assertion(r, doc, e, state, result, depth + 1))
            });
    }
    if raw_op == "not" {
        return rule
            .get("rule")
            .or_else(|| rule.get("predicate"))
            .is_some_and(|r| {
                valid_assertion(r, depth + 1) && !assertion(r, doc, e, state, result, depth + 1)
            });
    }
    let mut without_pointer = rule.clone();
    if let Some(o) = without_pointer.as_object_mut() {
        o.remove("pointer");
    }
    let expanded = match expand(&without_pointer, &e.bindings) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let op = str_field(&expanded, "op");
    let selected = match expanded.get("source").and_then(Value::as_str) {
        None | Some("stdout") => doc,
        Some(source) => match e.facts.get(source) {
            Some(v) => v,
            None => return false,
        },
    };
    // Escape dynamic pointer tokens separately; never interpolate a mount '/' as a separator.
    let pointer = match rule.get("pointer").and_then(Value::as_str) {
        Some(p) => match pointer_text(p, &e.bindings) {
            Ok(p) => p,
            Err(_) => return false,
        },
        None => String::new(),
    };
    match op {
        "equals" => expanded
            .get("value")
            .is_some_and(|expected| values_at(selected, &pointer).contains(&expected)),
        "exists" => !values_at(selected, &pointer).is_empty(),
        "verified" => state
            .host
            .facts
            .get(str_field(&expanded, "fact"))
            .is_some_and(|r| {
                fresh(r, state)
                    && r.get("value") == Some(&Value::Bool(true))
                    && opaque(str_field(r, "authorityRef"))
            }),
        "private-file" => e
            .bindings
            .get(str_field(&expanded, "binding"))
            .is_some_and(|b| {
                str_field(b, "type") == "session-private-path"
                    && fresh(b, state)
                    && str_field(b, "mode") == str_field(&expanded, "mode")
                    && str_field(b, "parentMode") == str_field(&expanded, "parentMode")
            }),
        "port-unoccupied" => selected
            .pointer(&pointer)
            .and_then(Value::as_array)
            .is_some_and(|ports| {
                typed("port", &expanded["port"])
                    && ports.iter().all(|p| typed("port", p))
                    && !ports.contains(&expanded["port"])
            }),
        "exact-route" => expanded
            .get("expected")
            .is_some_and(|v| selected.pointer(&pointer) == Some(v)),
        "owned-ledger-match" => e.ledger.as_ref().is_some_and(|l| {
            selected.pointer(&pointer) == Some(&l.details)
                && result
                    .get("ownershipReceipt")
                    .or(e.ownership_receipt.as_ref())
                    .is_some_and(|r| continuity(r, l, state))
        }),
        "owned-route-absent" => selected.pointer(&pointer).is_none_or(Value::is_null),
        _ => false,
    }
}
fn valid_assertion(rule: &Value, depth: usize) -> bool {
    if depth > 32 || !rule.is_object() {
        return false;
    }
    let allowed: &[&str] = match str_field(rule, "op") {
        "all" => {
            let Some(items) = rule
                .get("rules")
                .or_else(|| rule.get("items"))
                .and_then(Value::as_array)
            else {
                return false;
            };
            if items.len() > 64 || !items.iter().all(|r| valid_assertion(r, depth + 1)) {
                return false;
            }
            &["op", "rules", "items"]
        }
        "not" => {
            if !rule
                .get("rule")
                .or_else(|| rule.get("predicate"))
                .is_some_and(|r| valid_assertion(r, depth + 1))
            {
                return false;
            }
            &["op", "rule", "predicate"]
        }
        "equals" => {
            if rule.get("value").is_none() || !rule.get("pointer").is_some_and(Value::is_string) {
                return false;
            }
            &["op", "source", "pointer", "value"]
        }
        "exists" => {
            if !rule.get("pointer").is_some_and(Value::is_string) {
                return false;
            }
            &["op", "source", "pointer"]
        }
        "verified" => {
            if !rule.get("fact").is_some_and(Value::is_string) {
                return false;
            }
            &["op", "fact"]
        }
        "private-file" => &["op", "binding", "mode", "parentMode", "owner"],
        "port-unoccupied" => {
            if rule.get("source").is_none()
                || rule.get("pointer").is_none()
                || rule.get("port").is_none()
            {
                return false;
            }
            &["op", "source", "pointer", "port"]
        }
        "exact-route" => {
            if rule.get("expected").is_none() || rule.get("pointer").is_none() {
                return false;
            }
            &["op", "source", "pointer", "expected"]
        }
        "owned-ledger-match" | "owned-route-absent" => {
            if rule.get("source").is_none() || rule.get("pointer").is_none() {
                return false;
            }
            &["op", "source", "pointer"]
        }
        _ => return false,
    };
    rule.as_object()
        .is_some_and(|o| o.keys().all(|k| allowed.contains(&k.as_str())))
}
fn valid_capture(spec: &Value, depth: usize) -> bool {
    if depth > 12 || !spec.is_object() {
        return false;
    }
    let kind = str_field(spec, "type");
    let allowed = &[
        "type",
        "pointer",
        "optional",
        "trimTrailingDot",
        "fields",
        "paths",
    ];
    if spec
        .as_object()
        .is_none_or(|o| o.keys().any(|k| !allowed.contains(&k.as_str())))
    {
        return false;
    }
    match kind {
        "record" => spec
            .get("fields")
            .and_then(Value::as_object)
            .is_some_and(|o| o.len() <= 32 && o.values().all(|v| valid_capture(v, depth + 1))),
        "port-set" => spec
            .get("paths")
            .and_then(Value::as_array)
            .is_some_and(|a| !a.is_empty() && a.len() <= 32 && a.iter().all(Value::is_string)),
        "bool" | "port" | "dns-name" | "opaque-ref" | "origin" | "mount" => {
            spec.get("pointer").is_some_and(Value::is_string)
        }
        _ => false,
    }
}
fn executable(recipe: &Recipe) -> Result<Recipe, String> {
    let mut recipe = recipe.clone();
    for key in ["before", "requires", "after", "ledger", "process"] {
        recipe.fields.remove(key);
    }
    Ok(recipe)
}
fn parse_steps(recipe: &Recipe, key: &str) -> Result<Vec<PlanStep>, String> {
    match recipe.fields.get(key) {
        None => Ok(vec![]),
        Some(v) => {
            let steps: Vec<PlanStep> =
                serde_json::from_value(v.clone()).map_err(|_| "Invalid bounded plan steps")?;
            if steps.len() > 16 {
                return Err("Plan step bound exceeded".into());
            }
            let mut ids = std::collections::BTreeSet::new();
            for step in &steps {
                if !opaque(&step.id)
                    || !ids.insert(&step.id)
                    || !valid_recipe(&step.recipe, true)
                    || step.assert.as_ref().is_some_and(|a| !valid_assertion(a, 0))
                    || step.captures.len() > 32
                    || step.captures.values().any(|v| !valid_capture(v, 0))
                {
                    return Err("Unsupported or duplicate observation step/guard/capture".into());
                }
            }
            Ok(steps)
        }
    }
}
fn valid_recipe(recipe: &Recipe, observation: bool) -> bool {
    let mut allowed = vec!["parser", "timeoutMs", "maxOutputBytes"];
    match recipe.kind {
        EffectKind::Spawn => allowed.extend(["program", "args", "longRunning", "collectMs"]),
        EffectKind::ReadFile => allowed.extend(["handleRef"]),
        EffectKind::Interfaces => {}
        EffectKind::HttpProbe => {
            allowed.extend(["url", "vantage", "sse", "streamableHttp", "oauthDcr"])
        }
        EffectKind::LocalForwarder if !observation => {
            allowed.extend(["bindAddress", "port", "targetHost", "targetPort"])
        }
        EffectKind::OwnedProcess if !observation => allowed.extend([
            "resourceId",
            "signal",
            "graceMs",
            "thenSignal",
            "confirmExit",
            "cleanupPrivateArtifacts",
        ]),
        _ => return false,
    }
    if !observation {
        allowed.extend([
            "before",
            "requires",
            "after",
            "ledger",
            "process",
            "resourceId",
        ]);
    }
    if recipe.fields.keys().any(|k| !allowed.contains(&k.as_str())) {
        return false;
    }
    if observation && recipe.fields.get("longRunning") == Some(&Value::Bool(true)) {
        return false;
    }
    if recipe.kind == EffectKind::OwnedProcess
        && !observation
        && (recipe.fields.get("confirmExit") != Some(&Value::Bool(true))
            || recipe.fields.get("signal").and_then(Value::as_str) != Some("SIGTERM")
            || recipe.fields.get("thenSignal").and_then(Value::as_str) != Some("SIGKILL")
            || recipe
                .fields
                .get("graceMs")
                .and_then(Value::as_u64)
                .is_none_or(|n| n > 10_000))
    {
        return false;
    }
    if recipe.kind == EffectKind::Spawn
        && (!recipe.fields.get("program").is_some_and(|v| {
            v.as_str()
                .is_some_and(|s| !s.is_empty() && !s.contains(['{', '}', '\0']))
        }) || !recipe.fields.get("args").is_some_and(Value::is_array))
    {
        return false;
    }
    if let Some(parser) = recipe.fields.get("parser") {
        match str_field(parser, "kind") {
            "contains" | "url" | "json" | "exit-code" => {}
            "json-document" => {
                if !parser
                    .get("predicate")
                    .is_some_and(|p| valid_assertion(p, 0))
                {
                    return false;
                }
            }
            _ => return false,
        }
    }
    if let Some(p) = recipe.fields.get("process") {
        let Some(object) = p.as_object() else {
            return false;
        };
        if object
            .keys()
            .any(|k| !["mode", "stdin", "lifetimeMs", "collectMs"].contains(&k.as_str()))
            || str_field(p, "stdin") != "closed"
            || !["owned-long-running", "bounded-command", "owned-listener"]
                .contains(&str_field(p, "mode"))
        {
            return false;
        }
        if str_field(p, "mode") == "owned-long-running"
            && !p
                .get("lifetimeMs")
                .and_then(Value::as_u64)
                .is_some_and(|n| n > 0 && n <= 86_400_000)
        {
            return false;
        }
    }
    true
}
fn admissible(a: &Adapter, state: &State) -> Result<(), String> {
    let admission = a
        .admission
        .as_ref()
        .ok_or("Operational plan needs explicit admission")?;
    if a.plan_version != Some(1) || str_field(admission, "state") != "admitted" {
        return Err("Operational plan not admitted".into());
    }
    let features = admission
        .get("requiredFeatures")
        .and_then(Value::as_array)
        .ok_or("Plan needs required feature set")?;
    for feature in features {
        let feature = feature.as_str().ok_or("Invalid required feature")?;
        if !FEATURES.contains(&feature) || !state.host.features.iter().any(|f| f == feature) {
            return Err(format!("Unsupported core/host plan feature: {feature}"));
        }
    }
    if let Some(bindings) = &a.bindings {
        let specs = bindings.as_object().ok_or("Invalid binding specs")?;
        for spec in specs.values() {
            if ![
                "literal",
                "loopback-port",
                "port",
                "unused-port",
                "mount",
                "dns-name",
                "loopback-http-origin",
                "credential-free-https-origin",
                "selected-interface-address",
                "opaque-private-reference",
                "session-private-path",
                "reserved-unused-port",
            ]
            .contains(&str_field(spec, "type"))
            {
                return Err("Unsupported typed binding".into());
            }
            if spec.as_object().is_none_or(|o| {
                o.keys().any(|k| {
                    ![
                        "type",
                        "value",
                        "source",
                        "pointer",
                        "trimTrailingDot",
                        "candidates",
                        "protectedPorts",
                    ]
                    .contains(&k.as_str())
                })
            }) {
                return Err("Unsupported binding guard; normalize the entire binding".into());
            }
        }
    }
    for (operation, recipe) in &a.recipes {
        if operation == "detect" {
            continue;
        }
        if !["create", "remove"].contains(&operation.as_str()) || !valid_recipe(recipe, false) {
            return Err("Unsupported executable plan field or operation".into());
        }
        parse_steps(recipe, "before")?;
        parse_steps(recipe, "after")?;
        if let Some(requires) = recipe.fields.get("requires") {
            if !requires
                .as_array()
                .is_some_and(|a| a.len() <= 64 && a.iter().all(|r| valid_assertion(r, 0)))
            {
                return Err("Unsupported plan prerequisite".into());
            }
        }
    }
    if a.ownership == "external-owned" && a.recipes.keys().any(|k| k != "detect") {
        return Err("External ownership permits validation only".into());
    }
    Ok(())
}
fn make_execution(
    a: &Adapter,
    operation: &str,
    resource: Option<&Resource>,
    state: &State,
) -> Result<Execution, String> {
    admissible(a, state)?;
    let recipe = a
        .recipes
        .get(operation)
        .cloned()
        .ok_or("No operational recipe")?;
    let before = parse_steps(&recipe, "before")?;
    let after = parse_steps(&recipe, "after")?;
    let requires = recipe
        .fields
        .get("requires")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let ledger = resource.and_then(|r| r.ledger.clone());
    let mut bindings = ledger
        .as_ref()
        .map(|l| l.bindings.clone())
        .unwrap_or_default();
    if operation == "remove" {
        for (name, saved) in &bindings {
            if let Some(authority) = saved.get("hostAuthority") {
                let current = state
                    .host
                    .bindings
                    .get(name)
                    .ok_or("Saved host identity binding is unavailable")?;
                if !fresh(current, state)
                    || current.get("value") != saved.get("value")
                    || current.get("handleRef") != saved.get("handleRef")
                    || current.get("authorityRef") != Some(authority)
                {
                    return Err("Current host identity binding differs from owned baseline".into());
                }
            }
        }
    }
    if let Some(r) = resource {
        bindings.insert("resourceId".into(),json!({"type":"resource-handle","value":r.id,"authorityRef":ledger.as_ref().map(|l|l.continuity_ref.as_str()).unwrap_or("")}));
    }
    Ok(Execution {
        adapter_id: a.id.clone(),
        operation: operation.into(),
        resource_id: resource.map(|r| r.id.clone()),
        generation: state.generation,
        recipe,
        before,
        after,
        requires,
        stage: "before".into(),
        index: 0,
        facts: BTreeMap::new(),
        bindings,
        started_at_ms: state.host.now_ms,
        valid_until_ms: 9_007_199_254_740_991,
        candidate: None,
        ledger,
        ownership_receipt: None,
    })
}
fn emit_scoped(out: &mut Output, e: &Execution, recipe: Recipe, stage: &str, step: &str) {
    let operation = if stage == "before" || stage == "after" {
        "observe"
    } else {
        &e.operation
    };
    let recipe_ref = if stage == "before"
        && step == "ownership"
        && recipe.fields.get("action") == Some(&json!("inspect"))
    {
        "remove/ownership".into()
    } else if ["before", "after"].contains(&stage) {
        format!("{}/{}/{}", e.operation, stage, step)
    } else {
        format!("{}/execute", e.operation)
    };
    let mut recipe = recipe;
    recipe.fields.insert("recipeRef".into(), json!(recipe_ref));
    recipe.fields.insert("stepId".into(), json!(step));
    recipe.fields.insert("stage".into(), json!(stage));
    recipe.fields.insert("bindings".into(), json!(e.bindings));
    recipe.fields.insert(
        "bindingRefs".into(),
        json!(e
            .bindings
            .iter()
            .map(|(k, v)| (k.clone(), v["authorityRef"].clone()))
            .collect::<BTreeMap<_, _>>()),
    );
    emit(
        out,
        &e.adapter_id,
        operation,
        recipe,
        None,
        e.resource_id.clone(),
        None,
    );
    let id = out.effects.last().expect("emitted effect").id.clone();
    out.state
        .pending
        .get_mut(&id)
        .expect("pending effect")
        .plan_ticket = Some(Ticket {
        stage: stage.into(),
        step_id: step.into(),
        execution_generation: e.generation,
    });
}
fn prepare_recipe(e: &Execution) -> Result<Recipe, String> {
    let mut recipe = executable(&e.recipe)?;
    if let Some(process) = e.recipe.fields.get("process") {
        if str_field(process, "mode") == "owned-long-running" {
            recipe.fields.insert("longRunning".into(), json!(true));
            recipe
                .fields
                .insert("lifetimeMs".into(), process["lifetimeMs"].clone());
            if let Some(collect) = process.get("collectMs") {
                recipe.fields.insert("collectMs".into(), collect.clone());
            }
        }
    }
    let parser = recipe.fields.remove("parser");
    recipe.fields = serde_json::from_value(expand(&json!(recipe.fields), &e.bindings)?)
        .map_err(|_| "Invalid expanded execution")?;
    if let Some(parser) = parser {
        recipe.fields.insert("parser".into(), parser);
    }
    Ok(recipe)
}
fn drive(out: &mut Output, mut e: Execution) -> Result<(), String> {
    let a = out
        .state
        .adapters
        .iter()
        .find(|a| a.id == e.adapter_id)
        .cloned()
        .ok_or("Lost adapter identity")?;
    resolve_bindings(&a, &mut e, &out.state, false)?;
    if e.stage == "before" {
        if let Some(step) = e.before.get(e.index) {
            let mut recipe = step.recipe.clone();
            recipe.fields = serde_json::from_value(expand(&json!(recipe.fields), &e.bindings)?)
                .map_err(|_| "Invalid expanded observation")?;
            emit_scoped(out, &e, recipe, "before", &step.id);
            out.state.execution = Some(e);
            return Ok(());
        }
        resolve_bindings(&a, &mut e, &out.state, true)?;
        if e.valid_until_ms <= out.state.host.now_ms {
            return Err("Preflight expired before durable intent".into());
        }
        if !e
            .requires
            .iter()
            .all(|r| assertion(r, &Value::Null, &e, &out.state, &Value::Null, 0))
        {
            return Err("Fresh preflight prerequisite failed".into());
        }
        if e.operation == "remove"
            && (e.ledger.is_none()
                || !e
                    .requires
                    .iter()
                    .any(|r| str_field(r, "op") == "owned-ledger-match"))
        {
            return Err("Removal lacks exact owned ledger/continuity guard".into());
        }
        let execute = prepare_recipe(&e)?;
        let record = json!({"operation":e.operation,"adapterId":e.adapter_id,"resourceId":e.resource_id,"sessionId":out.state.session_id,"generation":out.state.generation,"recipeRef":format!("{}/execute",e.operation),"execute":execute,"bindings":e.bindings,"baseline":e.facts,"ledger":e.ledger});
        let recipe = Recipe {
            kind: EffectKind::Persist,
            fields: BTreeMap::from([("record".into(), record)]),
        };
        e.stage = "persist".into();
        out.state.phase = "persisting".into();
        emit_scoped(out, &e, recipe, "persist", "intent");
        out.state.execution = Some(e);
        return Ok(());
    }
    if e.stage == "after" {
        if let Some(step) = e.after.get(e.index) {
            let mut recipe = step.recipe.clone();
            recipe.fields = serde_json::from_value(expand(&json!(recipe.fields), &e.bindings)?)
                .map_err(|_| "Invalid expanded readback")?;
            emit_scoped(out, &e, recipe, "after", &step.id);
            out.state.execution = Some(e);
            return Ok(());
        }
        if e.operation == "remove" {
            if let Some(r) = out
                .state
                .resources
                .iter_mut()
                .find(|r| Some(&r.id) == e.resource_id.as_ref() && r.ownership == "owned")
            {
                r.cleanup = "removed".into();
            }
            out.state.execution = None;
            cleanup(out);
            return Ok(());
        }
        out.state.execution = None;
        if out.state.stop_requested {
            cleanup(out);
            return Ok(());
        }
        let candidate = e
            .candidate
            .or_else(|| {
                a.endpoint_template
                    .as_ref()
                    .and_then(|s| expand(&json!(s), &e.bindings).ok())
                    .and_then(|s| s.as_str().and_then(origin))
            })
            .ok_or("No verified plan candidate origin")?;
        request_probe(out, &a, candidate)?;
        return Ok(());
    }
    Err("Invalid plan stage".into())
}
fn request_probe(out: &mut Output, a: &Adapter, url: String) -> Result<(), String> {
    let proof = out
        .state
        .host
        .probe
        .clone()
        .ok_or("Trusted instance probe challenge unavailable")?;
    if !opaque(str_field(&proof, "nonceRef"))
        || !opaque(str_field(&proof, "verifierRef"))
        || proof
            .get("expiresAtMs")
            .and_then(Value::as_u64)
            .is_none_or(|t| t <= out.state.host.now_ms)
    {
        return Err("Probe challenge missing authority or expired".into());
    }
    let nonce = str_field(&proof, "nonceRef").to_owned();
    if out.state.used_nonces.contains(&nonce) {
        return Err("Probe nonce was already used; a fresh challenge is required".into());
    }
    if out.state.used_nonces.len() >= 128 {
        return Err("Session probe budget exhausted".into());
    }
    out.state.used_nonces.push(nonce);
    out.state.health_expiry = None;
    probe(out, &a.id, url.clone());
    let Some(effect) = out
        .effects
        .last_mut()
        .filter(|e| e.kind == EffectKind::HttpProbe)
    else {
        return Err("Probe origin does not meet requirements".into());
    };
    effect.fields.insert("recipeRef".into(), json!("probe"));
    effect.fields.insert("stepId".into(), json!("probe"));
    effect.fields.insert("stage".into(), json!("probe"));
    effect.fields.insert("probe".into(), proof.clone());
    effect
        .fields
        .insert("tls".into(), json!(url.starts_with("https://")));
    let effect = effect.clone();
    let pending = out
        .state
        .pending
        .get_mut(&effect.id)
        .ok_or("Missing probe")?;
    pending.effect = effect;
    pending.plan_ticket = Some(Ticket {
        stage: "probe".into(),
        step_id: "probe".into(),
        execution_generation: out.state.generation,
    });
    Ok(())
}
pub fn start(out: &mut Output, cmd: &Value) {
    let result = (|| -> Result<(), String> {
        if out.state.execution.is_some()
            || out
                .state
                .pending
                .values()
                .any(|p| matches!(p.effect.operation.as_str(), "create" | "remove"))
            || out
                .state
                .resources
                .iter()
                .any(|r| r.ownership == "owned" && r.cleanup != "removed")
        {
            return Err("Session still owns resources or unresolved work".into());
        }
        let a = out
            .state
            .adapters
            .iter()
            .find(|a| a.id == str_field(cmd, "adapterId"))
            .cloned()
            .ok_or("Unknown adapter")?;
        admissible(&a, &out.state)?;
        if !potential(&a, &out.state.requirements) {
            return Err(
                "Audience or explicitly unsupported capability does not meet requirements".into(),
            );
        }
        if cmd.get("consent") != Some(&Value::Bool(true)) {
            out.action = Some(json!({"kind":"confirm","adapterId":a.id}));
            return Ok(());
        }
        out.state.generation += 1;
        out.state.stop_requested = false;
        out.state.selected = Some(a.id.clone());
        out.state.candidate = None;
        out.state.published = None;
        if a.ownership == "external-owned" {
            let mut e = Execution {
                adapter_id: a.id.clone(),
                operation: "validate".into(),
                resource_id: None,
                generation: out.state.generation,
                recipe: Recipe {
                    kind: EffectKind::HttpProbe,
                    fields: BTreeMap::new(),
                },
                before: vec![],
                after: vec![],
                requires: vec![],
                stage: "probe".into(),
                index: 0,
                facts: BTreeMap::new(),
                bindings: BTreeMap::new(),
                started_at_ms: out.state.host.now_ms,
                valid_until_ms: 9_007_199_254_740_991,
                candidate: None,
                ledger: None,
                ownership_receipt: None,
            };
            resolve_bindings(&a, &mut e, &out.state, true)?;
            let url = a
                .endpoint_template
                .as_ref()
                .and_then(|s| expand(&json!(s), &e.bindings).ok())
                .and_then(|s| s.as_str().and_then(origin))
                .or_else(|| a.endpoint.as_deref().and_then(origin))
                .ok_or("Existing external origin not provided by typed authority")?;
            request_probe(out, &a, url)?;
            return Ok(());
        }
        if a.ownership != "owned" {
            return Err("Unknown resource ownership".into());
        }
        let e = make_execution(&a, "create", None, &out.state)?;
        out.state.phase = "preflight".into();
        drive(out, e)
    })();
    if let Err(error) = result {
        fail(out, &error);
    }
}
pub fn cancel_readonly(out: &mut Output) {
    if !out.state.stop_requested {
        return;
    }
    if out.state.execution.as_ref().is_some_and(|e| {
        e.operation == "create" && matches!(e.stage.as_str(), "before" | "persist")
    }) {
        out.state.execution = None;
    }
}
pub fn reconcile_absent(out: &mut Output, cmd: &Value) {
    let id = str_field(cmd, "resourceId");
    let valid = out.state.resources.iter().any(|resource| {
        let Some(ledger) = resource.ledger.as_ref() else {
            return false;
        };
        let Some(receipt) = out.state.host.cleanup_absent.get(id) else {
            return false;
        };
        out.state.stop_requested
            && resource.id == id
            && resource.ownership == "owned"
            && resource.cleanup != "removed"
            && ledger.kind == "process"
            && ledger.handle_ref == id
            && !ledger.continuity_ref.is_empty()
            && receipt.as_object().is_some_and(|fields| {
                fields.keys().all(|key| {
                    [
                        "sessionId",
                        "handleRef",
                        "continuityRef",
                        "processGone",
                        "providerAbsent",
                        "observedAtMs",
                        "expiresAtMs",
                    ]
                    .contains(&key.as_str())
                })
            })
            && fresh(receipt, &out.state)
            && receipt.get("handleRef").and_then(Value::as_str) == Some(ledger.handle_ref.as_str())
            && receipt.get("continuityRef").and_then(Value::as_str)
                == Some(ledger.continuity_ref.as_str())
            && receipt.get("processGone") == Some(&Value::Bool(true))
            && receipt.get("providerAbsent") == Some(&Value::Bool(true))
    });
    if !valid {
        event(out, "cleanup-absence-unproven");
        return;
    }
    for resource in &mut out.state.resources {
        if resource.id == id {
            resource.cleanup = "removed".into();
        }
    }
    // A known absent allocation cannot finish an uncertain create or another removal.
    out.state.pending.retain(|_, pending| {
        !(pending.resource_id.as_deref() == Some(id)
            && (pending.effect.operation == "remove"
                || (pending.effect.operation == "observe"
                    && pending
                        .effect
                        .fields
                        .get("recipeRef")
                        .and_then(Value::as_str)
                        .is_some_and(|reference| reference.starts_with("remove/")))))
    });
    if out.state.execution.as_ref().is_some_and(|execution| {
        execution.operation == "remove" && execution.resource_id.as_deref() == Some(id)
    }) {
        out.state.execution = None;
    }
    event(out, "cleanup-absence-reconciled");
    stop_phase(out);
}
pub fn begin_cleanup(out: &mut Output, r: &Resource) {
    if out.state.execution.is_some()
        || out
            .state
            .pending
            .values()
            .any(|p| p.resource_id.as_ref() == Some(&r.id))
    {
        return;
    }
    let result = (|| -> Result<(), String> {
        let a = out
            .state
            .adapters
            .iter()
            .find(|a| a.id == r.adapter_id)
            .cloned()
            .ok_or("Removal adapter unavailable")?;
        let mut e = make_execution(&a, "remove", Some(r), &out.state)?;
        if e.recipe.kind == EffectKind::OwnedProcess || e.recipe.kind == EffectKind::LocalForwarder
        {
            // Intrinsic handle inspection: no synthetic provider schema or recursive command search.
            let kind = e.recipe.kind.clone();
            let ledger = e
                .ledger
                .clone()
                .ok_or("Immutable local ownership handle unavailable")?;
            e.before.insert(
                0,
                PlanStep {
                    id: "ownership".into(),
                    recipe: Recipe {
                        kind,
                        fields: BTreeMap::from([
                            ("action".into(), json!("inspect")),
                            ("ownership".into(), json!(ledger)),
                        ]),
                    },
                    captures: BTreeMap::new(),
                    assert: None,
                },
            );
            e.requires
                .push(json!({"op":"owned-ledger-match","source":"ownership","pointer":"/route"}));
        }
        out.state.phase = "cleanup-pending".into();
        drive(out, e)
    })();
    if let Err(error) = result {
        fail(out, &error);
    }
}
fn owned(result: &Value, e: &Execution, state: &State) -> Result<Ledger, String> {
    let value = result
        .get("ownership")
        .ok_or("Create has no immutable ownership receipt; outcome unresolved")?;
    let kind = str_field(value, "kind");
    let handle = str_field(value, "handleRef");
    let continuity = str_field(value, "continuityRef");
    if !opaque(handle)
        || !opaque(continuity)
        || !["process", "forwarder", "route"].contains(&kind)
        || str_field(value, "sessionId") != state.session_id
        || value.get("generation").and_then(Value::as_u64) != Some(e.generation)
    {
        return Err("Create ownership receipt is invalid or wrong scope".into());
    }
    let expected_kind = if e.recipe.kind == EffectKind::LocalForwarder {
        "forwarder"
    } else if e
        .recipe
        .fields
        .get("process")
        .is_some_and(|p| str_field(p, "mode") == "owned-long-running")
        || e.recipe.fields.get("longRunning") == Some(&Value::Bool(true))
    {
        "process"
    } else {
        "route"
    };
    if kind != expected_kind {
        return Err("Allocation receipt has wrong resource kind".into());
    }
    let details = value
        .get("details")
        .cloned()
        .ok_or("Ownership details absent")?;
    let expected = e
        .recipe
        .fields
        .get("ledger")
        .map(|v| expand(v, &e.bindings))
        .transpose()?;
    if !details.is_object() || details.to_string().len() > 8192 {
        return Err("Owned ledger details invalid or too large".into());
    }
    if kind == "route" && (expected.is_none() || e.after.is_empty()) {
        return Err("Mapping allocation requires exact ledger and readback".into());
    }
    Ok(Ledger {
        handle_ref: handle.into(),
        continuity_ref: continuity.into(),
        kind: kind.into(),
        details,
        baseline: json!(e.facts),
        bindings: e.bindings.clone(),
    })
}
fn record_allocation(out: &mut Output, e: &mut Execution, result: &Value) -> Result<(), String> {
    let ledger = owned(result, e, &out.state)?;
    if out
        .state
        .resources
        .iter()
        .any(|r| r.id == ledger.handle_ref)
    {
        return Err("Duplicate owned resource handle".into());
    }
    let current = e.generation == out.state.generation && !out.state.stop_requested;
    out.state.resources.push(Resource {
        id: ledger.handle_ref.clone(),
        adapter_id: e.adapter_id.clone(),
        generation: e.generation,
        ownership: "owned".into(),
        cleanup: if current { "active" } else { "pending" }.into(),
        ledger: Some(ledger.clone()),
    });
    e.resource_id = Some(ledger.handle_ref.clone());
    e.ledger = Some(ledger);
    Ok(())
}
pub fn expire(out: &mut Output) {
    withdraw(
        out,
        "Origin health receipt expired; a fresh intended-vantage check is required",
    );
}
fn withdraw(out: &mut Output, message: &str) {
    out.state.health_expiry = None;
    out.state.published = None;
    out.state.phase = "degraded".into();
    event(out, "endpoint-withdrawn");
    limit(out, message);
    out.action = Some(
        json!({"kind":"external","instruction":"The current address could not be verified. Check the owner-managed route and supply a fresh health receipt.","recheckCommand":"health"}),
    );
}
// Conservative public-unicast classification, using address values only (no DNS or IO).
fn public_relay_ip(value: &str) -> bool {
    match value.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192
                    && (b == 168 || (b == 0 && (c == 0 || c == 2)) || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        Ok(std::net::IpAddr::V6(ip)) => {
            let s = ip.segments();
            (s[0] & 0xe000) == 0x2000
                && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
                && s[0] != 0x2002
                && !(s[0] == 0x3fff && (s[1] & 0xf000) == 0)
        }
        Err(_) => false,
    }
}
fn valid_network_path(vantage: &str, receipt: &Value, challenge: &Value) -> bool {
    vantage == "local"
        || receipt.get("remote") == Some(&Value::Bool(true))
        || (vantage == "public"
            && str_field(receipt, "vantage") == "public"
            && challenge.get("allowPublicRelay") == Some(&Value::Bool(true))
            && receipt.get("remote") == Some(&Value::Bool(false))
            && str_field(receipt, "networkPath") == "public-relay"
            && receipt.get("publicDns") == Some(&Value::Bool(true))
            && public_relay_ip(str_field(receipt, "resolvedIp")))
}
fn finish_probe(out: &mut Output, p: &Pending, cmd: &Value) {
    let result = &cmd["result"];
    let receipt = &result["probeReceipt"];
    let challenge = &p.effect.fields["probe"];
    let url = p.origin.as_deref().unwrap_or("");
    let vantage = str_field(&json!(p.effect.fields), "vantage").to_owned();
    let required = &out.state.requirements;
    let now = out.state.host.now_ms;
    let valid = cmd.get("ok") == Some(&Value::Bool(true))
        && p.effect.generation == out.state.generation
        && !out.state.stop_requested
        && out.state.candidate.as_deref() == Some(url)
        && str_field(receipt, "nonceRef") == str_field(challenge, "nonceRef")
        && str_field(receipt, "verifierRef") == str_field(challenge, "verifierRef")
        && str_field(receipt, "origin") == url
        && str_field(receipt, "vantage") == vantage
        && receipt
            .get("observedAtMs")
            .and_then(Value::as_u64)
            .is_some_and(|t| t <= now)
        && receipt
            .get("expiresAtMs")
            .and_then(Value::as_u64)
            .is_some_and(|t| t > now)
        && challenge
            .get("expiresAtMs")
            .and_then(Value::as_u64)
            .is_some_and(|t| t > now)
        && receipt.get("instanceMatched") == Some(&Value::Bool(true))
        && valid_network_path(&vantage, receipt, challenge)
        && (!url.starts_with("https://") || receipt.get("tls") == Some(&Value::Bool(true)))
        && (!required.sse || receipt.get("sse") == Some(&Value::Bool(true)))
        && (!required.streamable_http || receipt.get("streamableHttp") == Some(&Value::Bool(true)))
        && (!required.oauth_dcr || receipt.get("oauthDcr") == Some(&Value::Bool(true)));
    out.state.pending.remove(&p.effect.id);
    if !valid {
        if p.effect.generation == out.state.generation && !out.state.stop_requested {
            withdraw(
                out,
                "Current origin health proof failed or expired; external owner action required",
            );
        } else {
            event(out, "stale-plan-probe");
        }
        return;
    }
    out.state.phase = "candidate-ready".into();
    event(out, "endpoint-proposed");
    out.action =
        Some(json!({"kind":"confirm-origin","origin":url,"generation":out.state.generation}));
    let expires = receipt["expiresAtMs"]
        .as_u64()
        .unwrap_or(now)
        .min(challenge["expiresAtMs"].as_u64().unwrap_or(now));
    out.state.health_expiry = Some(expires);
    let recipe = Recipe {
        kind: EffectKind::Timer,
        fields: BTreeMap::from([
            ("delayMs".into(), json!(expires - now)),
            ("expiresAtMs".into(), json!(expires)),
            ("recipeRef".into(), json!("health/expiry")),
            ("stepId".into(), json!("expiry")),
            ("stage".into(), json!("health")),
        ]),
    };
    emit(
        out,
        &p.adapter_id,
        "health",
        recipe,
        None,
        None,
        Some(url.into()),
    );
    let id = out.effects.last().expect("health timer").id.clone();
    out.state
        .pending
        .get_mut(&id)
        .expect("pending timer")
        .plan_ticket = Some(Ticket {
        stage: "health".into(),
        step_id: "expiry".into(),
        execution_generation: out.state.generation,
    });
}
pub fn complete(out: &mut Output, p: &Pending, cmd: &Value) {
    let ticket = p.plan_ticket.as_ref().expect("operational ticket");
    if ticket.stage == "probe" {
        finish_probe(out, p, cmd);
        return;
    }
    if ticket.stage == "health" {
        out.state.pending.remove(&p.effect.id);
        if p.effect.generation == out.state.generation
            && !out.state.stop_requested
            && out.state.candidate == p.origin
        {
            withdraw(
                out,
                "Origin health receipt expired; a fresh intended-vantage check is required",
            );
        }
        return;
    }
    let Some(mut e) = out.state.execution.take() else {
        out.state.pending.remove(&p.effect.id);
        event(out, "cancelled-plan-callback");
        if out.state.stop_requested {
            cleanup(out);
        }
        return;
    };
    if e.generation != ticket.execution_generation || e.stage != ticket.stage {
        out.state.execution = Some(e);
        event(out, "out-of-order-plan-callback");
        return;
    }
    let result = &cmd["result"];
    let ok = cmd.get("ok") == Some(&Value::Bool(true));
    let current = e.generation == out.state.generation && !out.state.stop_requested;
    let completed = (|| -> Result<(), String> {
        if e.stage == "persist" {
            out.state.pending.remove(&p.effect.id);
            if !ok || result.get("durable") != Some(&Value::Bool(true)) {
                return Err("Operational mutation intent was not durably acknowledged".into());
            }
            if e.operation == "create" && !current {
                return Ok(());
            }
            if e.valid_until_ms <= out.state.host.now_ms {
                return Err("Fresh preflight expired while intent was being persisted".into());
            }
            if !e
                .requires
                .iter()
                .all(|r| assertion(r, &Value::Null, &e, &out.state, &Value::Null, 0))
            {
                return Err("Preflight authority changed before mutation".into());
            }
            for (name, saved) in &e.bindings {
                if let Some(authority) = saved.get("hostAuthority") {
                    let current = out
                        .state
                        .host
                        .bindings
                        .get(name)
                        .ok_or("Host binding disappeared before mutation")?;
                    if !fresh(current, &out.state)
                        || current.get("value") != saved.get("value")
                        || current.get("handleRef") != saved.get("handleRef")
                        || current.get("authorityRef") != Some(authority)
                    {
                        return Err("Host binding identity changed before mutation".into());
                    }
                }
            }
            let recipe = prepare_recipe(&e)?;
            e.stage = "execute".into();
            emit_scoped(out, &e, recipe, "execute", "execute");
            out.state.execution = Some(e);
            return Ok(());
        }
        if e.stage == "execute" {
            let exit_ok = result
                .get("exitCode")
                .and_then(Value::as_i64)
                .is_none_or(|n| n == 0);
            if e.operation == "create" {
                if let Err(error) = record_allocation(out, &mut e, result) {
                    if !ok && result.get("notApplied") == Some(&Value::Bool(true)) {
                        out.state.pending.remove(&p.effect.id);
                        return Err("Create confirmed not applied".into());
                    }
                    // No safe attribution yet: retain request and never issue another create.
                    out.state.execution = Some(e);
                    limit(out, &error);
                    out.state.phase = if out.state.stop_requested {
                        "stopping"
                    } else {
                        "failed"
                    }
                    .into();
                    return Ok(());
                }
                out.state.pending.remove(&p.effect.id);
                if e.recipe
                    .fields
                    .get("ledger")
                    .map(|v| expand(v, &e.bindings))
                    .transpose()?
                    .as_ref()
                    .is_some_and(|expected| {
                        e.ledger.as_ref().is_none_or(|l| &l.details != expected)
                    })
                {
                    return Err("Created allocation differs from consented ledger; owned cleanup debt retained".into());
                }
                if !current {
                    if let Some(r) = out
                        .state
                        .resources
                        .iter_mut()
                        .find(|r| Some(&r.id) == e.resource_id.as_ref())
                    {
                        r.cleanup = "pending".into();
                    }
                    out.state.execution = None;
                    cleanup(out);
                    return Ok(());
                }
                if !ok || !exit_ok {
                    return Err("Create returned an owned allocation but completion failed; cleanup debt retained".into());
                }
                e.candidate = parse(&p.parser, result).and_then(|s| origin(&s));
            } else {
                out.state.pending.remove(&p.effect.id);
                if !ok || !exit_ok || result.get("removed") != Some(&Value::Bool(true)) {
                    return Err("Owned removal is unconfirmed; do not blindly reissue".into());
                }
            }
            e.stage = "after".into();
            e.index = 0;
            return drive(out, e);
        }
        if e.operation == "create" && !current {
            out.state.pending.remove(&p.effect.id);
            cleanup(out);
            return Ok(());
        }
        let steps = if e.stage == "before" {
            &e.before
        } else {
            &e.after
        };
        let step = steps
            .get(e.index)
            .cloned()
            .ok_or("Plan step cursor out of bounds")?;
        out.state.pending.remove(&p.effect.id);
        if step.id != ticket.step_id || !ok {
            return Err("Ordered observation failed".into());
        }
        let observation = &result["observation"];
        if !fresh(observation, &out.state)
            || !opaque(str_field(observation, "authorityRef"))
            || observation
                .get("observedAtMs")
                .and_then(Value::as_u64)
                .is_none_or(|t| t < e.started_at_ms)
        {
            return Err("Observation missing scoped fresh authority/time receipt".into());
        }
        e.valid_until_ms = e
            .valid_until_ms
            .min(observation["expiresAtMs"].as_u64().unwrap_or(0));
        let raw = str_field(result, "stdout");
        if raw.len() > 1_048_576 {
            return Err("Observation exceeds core byte limit".into());
        }
        let doc = if raw.is_empty() {
            result.clone()
        } else {
            serde_json::from_str(raw).map_err(|_| "Observation is not a JSON document")?
        };
        if step.id == "ownership" && step.recipe.fields.get("action") == Some(&json!("inspect")) {
            let ledger = e.ledger.as_ref().ok_or("Missing ownership ledger")?;
            let receipt = &result["ownershipReceipt"];
            if !continuity(receipt, ledger, &out.state)
                || doc.get("details") != Some(&ledger.details)
            {
                return Err("Local immutable handle continuity or exact details changed".into());
            }
            e.facts
                .insert(step.id.clone(), json!({"route":ledger.details}));
        } else {
            if step
                .assert
                .as_ref()
                .is_some_and(|rule| !assertion(rule, &doc, &e, &out.state, result, 0))
            {
                return Err(
                    "Raw current record assertion failed; preserve administrator changes".into(),
                );
            }
            if parse(&p.parser, result).is_none() {
                return Err("Observation parser failed".into());
            }
            let mut facts = serde_json::Map::new();
            for (name, spec) in &step.captures {
                facts.insert(name.clone(), capture(&doc, spec, &e.bindings, 0)?);
            }
            e.facts.insert(step.id.clone(), Value::Object(facts));
        }
        if let (Some(receipt), Some(ledger)) = (result.get("ownershipReceipt"), e.ledger.as_ref()) {
            if !continuity(receipt, ledger, &out.state) {
                return Err("Ownership continuity unknown or changed".into());
            }
            e.ownership_receipt = Some(
                json!({"handleRef":receipt["handleRef"],"continuityRef":receipt["continuityRef"],"sessionId":receipt["sessionId"],"observedAtMs":receipt["observedAtMs"],"expiresAtMs":receipt["expiresAtMs"],"continuous":true}),
            );
            e.valid_until_ms = e
                .valid_until_ms
                .min(receipt["expiresAtMs"].as_u64().unwrap_or(0));
        }
        e.index += 1;
        drive(out, e)
    })();
    if let Err(error) = completed {
        for r in &mut out.state.resources {
            if r.ledger.is_some() && r.cleanup != "removed" {
                r.cleanup = "pending".into();
            }
        }
        fail(out, &error);
    }
}
pub fn health(out: &mut Output, rotate: bool) {
    let result = (|| -> Result<(), String> {
        if out.state.stop_requested {
            return Err("Stopped session cannot refresh health".into());
        }
        let a = out
            .state
            .adapters
            .iter()
            .find(|a| Some(&a.id) == out.state.selected.as_ref() && a.plan_version == Some(1))
            .cloned()
            .ok_or("No operational session selected")?;
        let mut url = out.state.candidate.clone().ok_or("No current candidate")?;
        if rotate {
            if a.ownership != "external-owned" {
                return Err("Host origin updates apply only to external-owned routes".into());
            }
            let b = out
                .state
                .host
                .bindings
                .get("externalOrigin")
                .ok_or("Missing explicit origin authority")?;
            if !fresh(b, &out.state)
                || str_field(b, "type") != "credential-free-https-origin"
                || !typed("credential-free-https-origin", &b["value"])
            {
                return Err("Updated origin authority invalid or expired".into());
            }
            url = b["value"].as_str().ok_or("Invalid external origin")?.into();
        }
        out.state.generation += 1;
        out.state.published = None;
        out.state.candidate = None;
        event(out, "endpoint-withdrawn");
        request_probe(out, &a, url)
    })();
    if let Err(error) = result {
        withdraw(out, &error);
    }
}
pub fn potential(a: &Adapter, r: &Requirements) -> bool {
    if !super::reach_allowed(&a.audience, &r.client_reach) {
        return false;
    }
    [
        ("https", r.https_required || a.audience == "public"),
        ("sse", r.sse),
        ("streamableHttp", r.streamable_http),
        ("oauthDcr", r.oauth_dcr),
    ]
    .iter()
    .all(|(k, required)| !required || a.capabilities.get(*k) != Some(&Value::Bool(false)))
}
