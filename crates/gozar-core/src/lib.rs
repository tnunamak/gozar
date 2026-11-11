//! Deterministic transition machine. All environmental work is returned as effects.
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;
mod operational;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EffectKind {
    Spawn,
    ReadFile,
    HttpProbe,
    Interfaces,
    LocalForwarder,
    OwnedProcess,
    Persist,
    Timer,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub kind: EffectKind,
    #[serde(flatten)]
    pub fields: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Adapter {
    pub id: String,
    pub audience: String,
    pub ownership: String,
    #[serde(default)]
    pub capabilities: BTreeMap<String, Value>,
    #[serde(default)]
    pub recipes: BTreeMap<String, Recipe>,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub unknowns: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bindings: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub admission: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint_template: Option<String>,
    #[serde(default)]
    pub actions: Vec<Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Requirements {
    #[serde(default = "unknown")]
    pub client_reach: String,
    #[serde(default)]
    pub https_required: bool,
    #[serde(default)]
    pub sse: bool,
    #[serde(default)]
    pub streamable_http: bool,
    #[serde(default)]
    pub oauth_dcr: bool,
}
fn unknown() -> String {
    "unknown".into()
}
impl Default for Requirements {
    fn default() -> Self {
        Self {
            client_reach: unknown(),
            https_required: false,
            sse: false,
            streamable_http: false,
            oauth_dcr: false,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    pub id: String,
    pub session_id: String,
    pub generation: u64,
    pub kind: EffectKind,
    pub operation: String,
    pub adapter_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    #[serde(flatten)]
    pub fields: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: String,
    pub adapter_id: String,
    pub generation: u64,
    pub ownership: String,
    pub cleanup: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ledger: Option<operational::Ledger>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pending {
    effect: Effect,
    adapter_id: String,
    parser: Value,
    #[serde(default)]
    after: Option<Recipe>,
    #[serde(default)]
    resource_id: Option<String>,
    #[serde(default)]
    origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plan_ticket: Option<operational::Ticket>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub session_id: String,
    pub generation: u64,
    pub sequence: u64,
    pub phase: String,
    pub stop_requested: bool,
    pub candidate: Option<String>,
    pub published: Option<String>,
    pub adapters: Vec<Adapter>,
    pub requirements: Requirements,
    pub selected: Option<String>,
    pub resources: Vec<Resource>,
    pub observations: BTreeMap<String, String>,
    pub recommendations: Vec<String>,
    pub limitations: Vec<String>,
    pending: BTreeMap<String, Pending>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    execution: Option<operational::Execution>,
    #[serde(default)]
    host: operational::Host,
    #[serde(default)]
    used_nonces: Vec<String>,
    #[serde(default)]
    pub plans: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    health_expiry: Option<u64>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            session_id: "session".into(),
            generation: 0,
            sequence: 0,
            phase: "idle".into(),
            stop_requested: false,
            candidate: None,
            published: None,
            adapters: vec![],
            requirements: Requirements::default(),
            selected: None,
            resources: vec![],
            observations: BTreeMap::new(),
            recommendations: vec![],
            limitations: vec![],
            pending: BTreeMap::new(),
            execution: None,
            host: operational::Host::default(),
            used_nonces: vec![],
            plans: vec![],
            health_expiry: None,
        }
    }
}
#[derive(Deserialize)]
struct Input {
    #[serde(default)]
    state: State,
    command: Value,
    adapters: Option<Vec<Adapter>>,
    requirements: Option<Requirements>,
    #[serde(default)]
    host: Option<operational::Host>,
}
#[derive(Serialize)]
pub struct Output {
    pub state: State,
    pub events: Vec<Value>,
    pub effects: Vec<Effect>,
    pub snapshot: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<Value>,
}

fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
fn event(out: &mut Output, kind: &str) {
    out.events.push(
        json!({"type":kind,"sessionId":out.state.session_id,"generation":out.state.generation}),
    );
}
fn limit(out: &mut Output, text: &str) {
    if !out.state.limitations.iter().any(|x| x == text) {
        out.state.limitations.push(text.into());
    }
}
fn reach_allowed(audience: &str, reach: &str) -> bool {
    match audience {
        "public" => matches!(
            reach,
            "internet" | "unknown" | "tailnet" | "lan" | "this-device"
        ),
        "tailnet" => matches!(reach, "tailnet" | "this-device"),
        "lan" => matches!(reach, "lan" | "this-device"),
        "local" => reach == "this-device",
        _ => false,
    }
}
fn eligible(a: &Adapter, r: &Requirements) -> bool {
    reach_allowed(&a.audience, &r.client_reach)
        && [
            ("https", r.https_required || a.audience == "public"),
            ("sse", r.sse),
            ("streamableHttp", r.streamable_http),
            ("oauthDcr", r.oauth_dcr),
        ]
        .iter()
        .all(|(k, required)| !required || a.capabilities.get(*k) == Some(&Value::Bool(true)))
}
fn emit(
    out: &mut Output,
    adapter: &str,
    operation: &str,
    recipe: Recipe,
    after: Option<Recipe>,
    resource_id: Option<String>,
    origin: Option<String>,
) {
    out.state.sequence += 1;
    let mut fields = recipe.fields;
    let parser = fields
        .remove("parser")
        .unwrap_or(json!({"kind":"exit-code"}));
    // Scope fields always come from the machine, never from an adapter recipe.
    for key in [
        "id",
        "sessionId",
        "generation",
        "operation",
        "kind",
        "adapterId",
        "resourceId",
    ] {
        fields.remove(key);
    }
    let effect = Effect {
        id: format!(
            "{}:{}:{}",
            out.state.session_id, out.state.generation, out.state.sequence
        ),
        session_id: out.state.session_id.clone(),
        generation: out.state.generation,
        kind: recipe.kind,
        operation: operation.into(),
        adapter_id: adapter.into(),
        resource_id: resource_id.clone(),
        fields,
    };
    out.state.pending.insert(
        effect.id.clone(),
        Pending {
            effect: effect.clone(),
            adapter_id: adapter.into(),
            parser,
            after,
            resource_id,
            origin,
            plan_ticket: None,
        },
    );
    out.effects.push(effect);
}
fn persist(
    out: &mut Output,
    adapter: &str,
    operation: &str,
    recipe: Recipe,
    resource_id: Option<String>,
) {
    let record = json!({"operation":operation,"adapterId":adapter,"resourceId":resource_id,"sessionId":out.state.session_id,"generation":out.state.generation});
    let intent = Recipe {
        kind: EffectKind::Persist,
        fields: BTreeMap::from([("record".into(), record)]),
    };
    emit(
        out,
        adapter,
        operation,
        intent,
        Some(recipe),
        resource_id,
        None,
    );
}
fn origin(value: &str) -> Option<String> {
    // Only an origin, never paths, query strings, fragments or userinfo, survives.
    let rest = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.is_empty()
        || authority.contains('@')
        || authority.chars().any(|c| {
            c.is_whitespace() || c.is_control() || matches!(c, '"' | '\'' | '<' | '>' | '\\')
        })
    {
        return None;
    }
    Some(format!(
        "{}://{}",
        if value.starts_with("https://") {
            "https"
        } else {
            "http"
        },
        authority
    ))
}
// JSON pointers support array indices, escaped keys, and a wildcard over arrays/objects.
fn values_at<'a>(document: &'a Value, pointer: &str) -> Vec<&'a Value> {
    if pointer.is_empty() {
        return vec![document];
    }
    if !pointer.starts_with('/') {
        return vec![];
    }
    let mut values = vec![document];
    for token in pointer[1..].split('/') {
        let key = token.replace("~1", "/").replace("~0", "~");
        values = values
            .into_iter()
            .flat_map(|value| {
                if key == "*" {
                    match value {
                        Value::Array(a) => a.iter().collect(),
                        Value::Object(o) => o.values().collect(),
                        _ => vec![],
                    }
                } else {
                    value
                        .get(&key)
                        .or_else(|| key.parse::<usize>().ok().and_then(|i| value.get(i)))
                        .into_iter()
                        .collect()
                }
            })
            .collect();
    }
    values
}
fn predicate(document: &Value, rule: &Value, depth: usize) -> bool {
    predicate_value(document, rule, depth) == Some(true)
}
fn predicate_value(document: &Value, rule: &Value, depth: usize) -> Option<bool> {
    if depth > 32 {
        return None;
    }
    if rule
        .get("source")
        .and_then(Value::as_str)
        .is_some_and(|s| s != "stdout")
    {
        return None;
    }
    match str_field(rule, "op") {
        "all" => {
            let rules = rule
                .get("rules")
                .or_else(|| rule.get("items"))
                .or_else(|| rule.get("predicates"))?
                .as_array()?;
            let mut all = true;
            for r in rules {
                all &= predicate_value(document, r, depth + 1)?;
            }
            Some(all)
        }
        "not" => Some(!predicate_value(
            document,
            rule.get("rule").or_else(|| rule.get("predicate"))?,
            depth + 1,
        )?),
        "exists" => Some(!values_at(document, rule.get("pointer")?.as_str()?).is_empty()),
        "equals" => {
            let expected = rule.get("value")?;
            Some(values_at(document, rule.get("pointer")?.as_str()?).contains(&expected))
        }
        _ => None,
    }
}
fn supported_mutation(recipe: &Recipe) -> bool {
    // Never interpret an advanced plan as its first executable command.
    ![
        "before",
        "after",
        "requires",
        "process",
        "bindings",
        "assertions",
    ]
    .iter()
    .any(|k| recipe.fields.contains_key(*k))
}
fn strip_ansi(input: &str) -> String {
    let mut chars = input.chars().peekable();
    let mut output = String::new();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for ch in chars.by_ref() {
                if ('@'..='~').contains(&ch) {
                    break;
                }
            }
        } else {
            output.push(c);
        }
    }
    output
}
fn parse_url(parser: &Value, stdout: &str, stderr: &str) -> Option<String> {
    let text = strip_ansi(&format!("{stdout}\n{stderr}"));
    let prefix = str_field(parser, "prefix");
    let constraints = &parser["constraints"];
    let pattern = constraints.get("hostnamePattern").and_then(Value::as_str);
    let regex = if let Some(pattern) = pattern {
        if pattern.len() > 2048 {
            return None;
        }
        Some(Regex::new(pattern).ok()?)
    } else {
        None
    };
    let mut origins = std::collections::BTreeSet::new();
    for token in text.split_whitespace() {
        if !prefix.is_empty() && !token.starts_with(prefix) {
            continue;
        }
        if let Some(url) = origin(token) {
            if constraints.get("exactOriginToken") == Some(&Value::Bool(true)) && token != url {
                continue;
            }
            let authority = url.split("://").nth(1)?;
            let hostname = authority.split(':').next()?;
            if regex.as_ref().is_some_and(|r| !r.is_match(hostname)) {
                continue;
            }
            origins.insert(url);
        }
    }
    if origins.len() == 1 {
        origins.into_iter().next()
    } else {
        None
    }
}
fn parse(p: &Value, result: &Value) -> Option<String> {
    let stdout = str_field(result, "stdout");
    let stderr = str_field(result, "stderr");
    if stdout.len() + stderr.len() > 1_048_576 {
        return None;
    }
    match str_field(p, "kind") {
        "contains" => {
            let text = match str_field(p, "stream") {
                "stdout" => stdout.to_owned(),
                "stderr" => stderr.to_owned(),
                _ => format!("{stdout}\n{stderr}"),
            };
            (!str_field(p, "value").is_empty() && text.contains(str_field(p, "value")))
                .then(|| "present".into())
        }
        "url" => parse_url(p, stdout, stderr),
        "json-document" => {
            let doc = if stdout.is_empty() {
                result.clone()
            } else {
                serde_json::from_str::<Value>(stdout).ok()?
            };
            let valid = p
                .get("predicate")
                .is_some_and(|rule| predicate(&doc, rule, 0));
            valid.then(|| "present".into())
        }
        "json" => (if stdout.is_empty() {
            Some(result.clone())
        } else {
            serde_json::from_str::<Value>(stdout).ok()
        })?
        .pointer(str_field(p, "pointer"))?
        .as_str()
        .map(str::to_owned),
        "exit-code" | "" => (result.get("exitCode").and_then(Value::as_i64).unwrap_or(0) == 0)
            .then(|| "present".into()),
        _ => None,
    }
}
fn probe(out: &mut Output, adapter: &str, url: String) {
    if (out.state.requirements.https_required
        || matches!(
            out.state.requirements.client_reach.as_str(),
            "internet" | "unknown"
        ))
        && !url.starts_with("https://")
    {
        out.state.phase = "failed".into();
        limit(
            out,
            "Required public HTTPS origin was not provided; no probe or publication",
        );
        return;
    }
    let vantage = match out.state.requirements.client_reach.as_str() {
        "tailnet" => "tailnet",
        "lan" => "lan",
        "this-device" => "local",
        _ => "public",
    };
    let recipe = Recipe {
        kind: EffectKind::HttpProbe,
        fields: BTreeMap::from([
            ("url".into(), json!(url)),
            ("vantage".into(), json!(vantage)),
            ("timeoutMs".into(), json!(5000)),
            ("maxOutputBytes".into(), json!(16384)),
            ("sse".into(), json!(out.state.requirements.sse)),
            (
                "streamableHttp".into(),
                json!(out.state.requirements.streamable_http),
            ),
            ("oauthDcr".into(), json!(out.state.requirements.oauth_dcr)),
        ]),
    };
    out.state.candidate = Some(url.clone());
    out.state.phase = "validating".into();
    emit(out, adapter, "probe", recipe, None, None, Some(url));
}
fn cleanup(out: &mut Output) {
    operational::cancel_readonly(out);
    let resources = out.state.resources.clone();
    let stopped = out.state.stop_requested;
    for r in resources.iter().filter(|r| {
        r.ownership == "owned" && r.cleanup != "removed" && (stopped || r.cleanup == "pending")
    }) {
        if r.ledger.is_some() {
            operational::begin_cleanup(out, r);
            continue;
        }
        if out
            .state
            .pending
            .values()
            .any(|p| p.resource_id.as_ref() == Some(&r.id))
        {
            continue;
        }
        let recipe = out
            .state
            .adapters
            .iter()
            .find(|a| a.id == r.adapter_id && a.bindings.is_none() && a.admission.is_none())
            .and_then(|a| a.recipes.get("remove"))
            .cloned();
        if let Some(mut recipe) = recipe.filter(supported_mutation) {
            if let Some(Value::Array(args)) = recipe.fields.get_mut("args") {
                for arg in args {
                    if let Some(s) = arg.as_str() {
                        *arg = json!(s.replace("{resourceId}", &r.id));
                    }
                }
            }
            persist(out, &r.adapter_id, "remove", recipe, Some(r.id.clone()));
        } else {
            limit(
                out,
                "Owned resource has no removal recipe; manual cleanup required",
            );
        }
    }
    stop_phase(out);
}
fn stop_phase(out: &mut Output) {
    if out.state.stop_requested {
        out.state.phase = if out
            .state
            .pending
            .values()
            .any(|p| p.effect.operation == "create")
        {
            "stopping"
        } else if out
            .state
            .resources
            .iter()
            .any(|r| r.ownership == "owned" && r.cleanup != "removed")
        {
            "cleanup-pending"
        } else {
            "stopped"
        }
        .into();
    }
}

pub fn transition(input: &str) -> Result<Output, String> {
    let input: Input = serde_json::from_str(input)
        .map_err(|_| "invalid input JSON or protocol shape".to_string())?;
    let mut out = Output {
        state: input.state,
        events: vec![],
        effects: vec![],
        snapshot: Value::Null,
        action: None,
    };
    if let Some(a) = input.adapters {
        if out.state.pending.is_empty() && out.state.selected.is_none() {
            out.state.adapters = a;
        }
    }
    if let Some(r) = input.requirements {
        if out.state.selected.is_none() {
            out.state.requirements = r;
        }
    }
    if let Some(host) = input.host {
        if host.now_ms < out.state.host.now_ms {
            return Err("host clock moved backwards".into());
        }
        out.state.host = host;
    }
    if out
        .state
        .health_expiry
        .is_some_and(|expires| expires <= out.state.host.now_ms)
    {
        operational::expire(&mut out);
    }
    let cmd = input.command;
    if out.state.sequence == 0 {
        if let Some(id) = cmd.get("sessionId").and_then(Value::as_str) {
            out.state.session_id = id.into();
        }
    }
    match str_field(&cmd, "type") {
        "detect" | "recommend"
            if out.state.selected.is_some()
                && !matches!(out.state.phase.as_str(), "stopped" | "failed") =>
        {
            event(&mut out, "session-already-active")
        }
        "detect" => {
            out.state.phase = "detecting".into();
            for a in out.state.adapters.clone() {
                if let Some(recipe) = a.recipes.get("detect").filter(|r| supported_mutation(r)) {
                    emit(&mut out, &a.id, "detect", recipe.clone(), None, None, None);
                } else {
                    out.state.observations.insert(a.id, "unknown".into());
                }
            }
        }
        "recommend" => {
            let mut candidates = out
                .state
                .adapters
                .iter()
                .filter(|a| operational::potential(a, &out.state.requirements))
                .cloned()
                .collect::<Vec<_>>();
            candidates.sort_by_key(|a| {
                match out.state.observations.get(&a.id).map(String::as_str) {
                    Some("present") => 0,
                    Some("unknown") | None => 1,
                    Some("signed-out") => 2,
                    Some("absent") => 3,
                    _ => 4,
                }
            });
            out.state.recommendations = candidates.iter().map(|a| a.id.clone()).collect();
            out.state.plans=candidates.iter().map(|a|json!({"adapterId":a.id,"eligibility":"needs-validation","observation":out.state.observations.get(&a.id).map(String::as_str).unwrap_or("unknown"),"preconditionActions":a.actions,"capabilityValidationRequired":true})).collect();
            if out.state.requirements.client_reach == "unknown" {
                limit(
                    &mut out,
                    "Client reach unknown; public HTTPS first, client validation still required",
                );
            }
            for a in out.state.adapters.clone() {
                for u in a.unknowns {
                    limit(&mut out, &u);
                }
            }
            out.state.phase = "planned".into();
            out.action = Some(json!({"kind":"choose","choices":out.state.recommendations}));
        }
        "start"
            if out
                .state
                .adapters
                .iter()
                .any(|a| a.id == str_field(&cmd, "adapterId") && a.plan_version == Some(1)) =>
        {
            operational::start(&mut out, &cmd)
        }
        "start" => {
            let id = str_field(&cmd, "adapterId");
            let adapter = out.state.adapters.iter().find(|a| a.id == id).cloned();
            if out.state.selected.is_some()
                && !matches!(out.state.phase.as_str(), "stopped" | "failed")
            {
                event(&mut out, "already-started");
            } else if let Some(a) = adapter {
                if !eligible(&a, &out.state.requirements) {
                    event(&mut out, "requirements-not-met");
                } else if cmd.get("consent") != Some(&Value::Bool(true)) {
                    out.action = Some(json!({"kind":"confirm","adapterId":id}));
                } else if out
                    .state
                    .pending
                    .values()
                    .any(|p| p.effect.operation == "create" || p.effect.operation == "remove")
                    || out
                        .state
                        .resources
                        .iter()
                        .any(|r| r.ownership == "owned" && r.cleanup != "removed")
                {
                    event(&mut out, "cleanup-required");
                } else {
                    out.state.generation += 1;
                    out.state.stop_requested = false;
                    out.state.selected = Some(a.id.clone());
                    out.state.candidate = None;
                    out.state.published = None;
                    if a.bindings.is_some() || a.admission.is_some() {
                        event(&mut out, "adapter-features-not-admitted");
                        limit(&mut out,"Adapter bindings or admission requirements are unsupported; no operation executed");
                        out.state.phase = "failed".into();
                    } else if a.ownership == "external-owned" {
                        if let Some(url) = a.endpoint.as_deref().and_then(origin) {
                            probe(&mut out, &a.id, url);
                        } else {
                            limit(
                                &mut out,
                                "External route requires an existing valid endpoint",
                            );
                            out.state.phase = "failed".into();
                        }
                    } else if a.ownership != "owned" {
                        event(&mut out, "unknown-ownership");
                        out.state.phase = "failed".into();
                    } else if let Some(recipe) =
                        a.recipes.get("create").filter(|r| supported_mutation(r))
                    {
                        out.state.phase = "persisting".into();
                        persist(&mut out, &a.id, "create", recipe.clone(), None);
                    } else {
                        out.state.phase = "failed".into();
                        limit(&mut out, "Adapter has no admitted create recipe");
                    }
                }
            } else {
                event(&mut out, "adapter-unknown");
            }
        }
        "effect-result" => complete(&mut out, &cmd),
        "stop" => {
            if !out.state.stop_requested {
                out.state.stop_requested = true;
                out.state.generation += 1;
                out.state.published = None;
                out.state.candidate = None;
                for r in &mut out.state.resources {
                    if r.ownership == "owned" && r.cleanup != "removed" {
                        r.cleanup = "pending".into();
                    }
                }
                event(&mut out, "endpoint-withdrawn");
            }
            cleanup(&mut out);
        }
        "reconcile" => cleanup(&mut out),
        "reconcile-absent" => operational::reconcile_absent(&mut out, &cmd),
        "health" => operational::health(&mut out, false),
        "update-origin" => operational::health(&mut out, true),
        "approve-origin" => {
            if !out.state.stop_requested
                && out.state.phase == "candidate-ready"
                && cmd.get("generation").and_then(Value::as_u64) == Some(out.state.generation)
                && cmd.get("origin").and_then(Value::as_str) == out.state.candidate.as_deref()
            {
                out.state.published = out.state.candidate.clone();
                out.state.phase = "published-ready".into();
                event(&mut out, "endpoint-published");
            } else {
                event(&mut out, "stale-origin-approval");
            }
        }
        "status" => {}
        _ => event(&mut out, "unsupported-command"),
    }
    out.snapshot = json!({"sessionId":out.state.session_id,"generation":out.state.generation,"phase":out.state.phase,"candidate":out.state.candidate,"published":out.state.published,"observations":out.state.observations,"recommendations":out.state.recommendations,"plans":out.state.plans,"resources":out.state.resources,"limitations":out.state.limitations});
    Ok(out)
}
fn complete(out: &mut Output, cmd: &Value) {
    let id = str_field(cmd, "effectId");
    let Some(p) = out.state.pending.get(id).cloned() else {
        event(out, "unknown-or-duplicate-effect");
        return;
    };
    if str_field(cmd, "sessionId") != p.effect.session_id
        || cmd.get("generation").and_then(Value::as_u64) != Some(p.effect.generation)
    {
        event(out, "effect-scope-mismatch");
        return;
    }
    if p.plan_ticket.is_some() {
        operational::complete(out, &p, cmd);
        return;
    }
    out.state.pending.remove(id);
    let result = cmd.get("result").cloned().unwrap_or(json!({}));
    let ok = cmd.get("ok") == Some(&Value::Bool(true));
    let current = p.effect.generation == out.state.generation && !out.state.stop_requested;
    if p.effect.kind == EffectKind::Persist {
        if ok && result.get("durable") == Some(&Value::Bool(true)) {
            if p.effect.operation == "remove" || current {
                if let Some(recipe) = p.after {
                    emit(
                        out,
                        &p.adapter_id,
                        &p.effect.operation,
                        recipe,
                        None,
                        p.resource_id,
                        None,
                    );
                    if p.effect.operation == "create" {
                        out.state.phase = "starting".into();
                    }
                }
            }
        } else {
            event(out, "durability-not-acknowledged");
            if current {
                out.state.phase = "failed".into();
            }
        }
        if ok && result.get("durable") == Some(&Value::Bool(true)) && out.state.stop_requested {
            cleanup(out);
        }
        return;
    }
    match p.effect.operation.as_str() {
        "detect" => {
            let parsed = parse(&p.parser, &result);
            let found = ok
                && if str_field(&p.parser, "kind") == "json" {
                    p.parser.get("predicate").is_some_and(|rule| {
                        let doc = serde_json::from_str::<Value>(str_field(&result, "stdout"))
                            .unwrap_or(Value::Null);
                        predicate(&doc, rule, 0)
                    })
                } else {
                    parsed.is_some()
                };
            out.state.observations.insert(
                p.adapter_id,
                if found { "present" } else { "unknown" }.into(),
            );
            event(out, "detection-recorded");
        }
        "create" => {
            if ok {
                let resource_id = result
                    .get("resourceId")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty() && s.len() <= 512)
                    .map(str::to_owned)
                    .unwrap_or(p.effect.id.clone());
                out.state.resources.push(Resource {
                    id: resource_id,
                    adapter_id: p.adapter_id.clone(),
                    generation: p.effect.generation,
                    ownership: "owned".into(),
                    cleanup: if current { "active" } else { "pending" }.into(),
                    ledger: None,
                });
                if current {
                    let parsed = if result
                        .get("exitCode")
                        .and_then(Value::as_i64)
                        .is_some_and(|code| code != 0)
                    {
                        None
                    } else {
                        parse(&p.parser, &result).and_then(|s| origin(&s))
                    };
                    if let Some(url) = parsed {
                        if out.state.requirements.https_required && !url.starts_with("https://") {
                            out.state.phase = "failed".into();
                            limit(out, "Adapter returned an origin without required HTTPS");
                        } else {
                            probe(out, &p.adapter_id, url);
                        }
                    } else {
                        out.state.phase = "failed".into();
                        limit(out,"Adapter output did not provide a valid origin; cleanup remains tracked");
                    }
                } else {
                    event(out, "late-create-cleanup-debt");
                    cleanup(out);
                }
            } else {
                event(out, "create-failed-or-uncertain");
                // A timeout/cancel is not proof that the provider did not create a route.
                // Retain the scoped request until a late callback or explicit not-applied receipt.
                if result.get("notApplied") != Some(&Value::Bool(true)) {
                    out.state.pending.insert(p.effect.id.clone(), p.clone());
                    limit(out,"Create outcome uncertain; retain request for late completion or a not-applied receipt");
                }
                if current {
                    out.state.phase = "failed".into();
                } else if out.state.stop_requested {
                    cleanup(out);
                }
            }
        }
        "probe" => {
            let expected = p.effect.fields.get("vantage").and_then(Value::as_str);
            let status = result.get("status").and_then(Value::as_u64).unwrap_or(0);
            if current
                && out.state.phase == "validating"
                && out.state.candidate == p.origin
                && ok
                && (200..300).contains(&status)
                && result.get("vantage").and_then(Value::as_str) == expected
                && (!out.state.requirements.sse
                    || result.get("streaming") == Some(&Value::Bool(true)))
                && (!out.state.requirements.streamable_http
                    || result.get("streamableHttp") == Some(&Value::Bool(true)))
                && (!out.state.requirements.oauth_dcr
                    || result.get("oauthDcr") == Some(&Value::Bool(true)))
            {
                out.state.phase = "candidate-ready".into();
                event(out, "endpoint-proposed");
                out.action = Some(
                    json!({"kind":"confirm-origin","generation":out.state.generation,"origin":out.state.candidate}),
                );
            } else {
                event(out, "probe-rejected-or-stale");
            }
        }
        "remove" => {
            let confirmed = ok
                && (result.get("removed") == Some(&Value::Bool(true))
                    || result.get("exitCode").and_then(Value::as_i64) == Some(0))
                && result
                    .get("exitCode")
                    .and_then(Value::as_i64)
                    .is_none_or(|code| code == 0);
            if confirmed {
                if let Some(r) = out.state.resources.iter_mut().find(|r| {
                    Some(&r.id) == p.resource_id.as_ref()
                        && r.adapter_id == p.adapter_id
                        && r.ownership == "owned"
                }) {
                    r.cleanup = "removed".into();
                }
            } else {
                event(out, "cleanup-pending");
            }
            // A failed removal is retried only by an explicit reconcile command.
            if out.state.stop_requested {
                out.state.phase = if out
                    .state
                    .resources
                    .iter()
                    .any(|r| r.ownership == "owned" && r.cleanup != "removed")
                {
                    "cleanup-pending"
                } else if out
                    .state
                    .pending
                    .values()
                    .any(|p| p.effect.operation == "create")
                {
                    "stopping"
                } else {
                    "stopped"
                }
                .into();
            }
        }
        _ => event(out, "unsupported-completion"),
    }
}

#[wasm_bindgen]
pub fn step(input_json: &str) -> String {
    match transition(input_json) {
        Ok(output) => serde_json::to_string(&output).expect("serializable core state"),
        Err(error) => json!({"error":{"code":"invalid-input","message":error}}).to_string(),
    }
}
