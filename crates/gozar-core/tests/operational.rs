use serde_json::{json, Value};
fn run(input: Value) -> Value {
    let out: Value = serde_json::from_str(&gozar_core::step(&input.to_string())).unwrap();
    assert!(out.get("state").is_some(), "{out}");
    let roundtrip = serde_json::from_value::<gozar_core::State>(out["state"].clone());
    assert!(
        roundtrip.is_ok(),
        "state cannot roundtrip: {}",
        roundtrip.unwrap_err()
    );
    out
}
fn fixture() -> Value {
    serde_json::from_str(include_str!("../../../test/adapters/fixtures/plan-v1.json")).unwrap()
}
fn definition(name: &str) -> Value {
    let text = match name {
        "private" => include_str!("../../../adapters/tailscale-private.definition.json"),
        "public" => include_str!("../../../adapters/tailscale-funnel.definition.json"),
        "process" => include_str!("../../../adapters/localhost-run.definition.json"),
        "lan" => include_str!("../../../adapters/lan.definition.json"),
        _ => include_str!("../../../adapters/own-address.definition.json"),
    };
    serde_json::from_str::<Value>(text).unwrap()["definition"].clone()
}
fn begin(a: &Value, host: &Value) -> Value {
    run(
        json!({"command":{"type":"start","sessionId":"plan-fixture","adapterId":a["id"],"consent":true},"adapters":[a],"host":host,"requirements":{"clientReach":if a["audience"]=="public"{"internet"}else{a["audience"].as_str().unwrap()},"httpsRequired":a["audience"]!="lan"}}),
    )
}
fn ack(out: &Value, result: Value, host: &Value) -> Value {
    let e = &out["effects"][0];
    run(
        json!({"state":out["state"],"host":host,"command":{"type":"effect-result","effectId":e["id"],"sessionId":e["sessionId"],"generation":e["generation"],"ok":true,"result":result}}),
    )
}
fn expand(v: &Value, b: &Value) -> Value {
    match v {
        Value::String(s) => {
            if let Some(name) = s.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
                return b[name]["value"].clone();
            }
            let mut text = s.clone();
            for (name, binding) in b.as_object().unwrap() {
                let value = &binding["value"];
                let value = value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string());
                text = text.replace(&format!("{{{name}}}"), &value);
            }
            json!(text)
        }
        Value::Array(a) => Value::Array(a.iter().map(|v| expand(v, b)).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, v)| (k.clone(), expand(v, b))).collect())
        }
        _ => v.clone(),
    }
}
fn response(out: &Value, a: &Value, host: &Value, baseline: &Value) -> Value {
    let e = &out["effects"][0];
    let f = fixture();
    let receipt = json!({"handleRef":"fixture-resource","continuityRef":"fixture-continuity","sessionId":"plan-fixture","observedAtMs":host["nowMs"],"expiresAtMs":100000,"continuous":true});
    if e["kind"] == "persist" {
        return json!({"durable":true});
    }
    if e["stage"] == "probe" {
        return json!({"probeReceipt":{"nonceRef":host["probe"]["nonceRef"],"verifierRef":host["probe"]["verifierRef"],"origin":e["url"],"vantage":e["vantage"],"observedAtMs":host["nowMs"],"expiresAtMs":100000,"tls":true,"instanceMatched":true,"sse":true,"streamableHttp":true,"oauthDcr":true,"remote":true}});
    }
    if e["stage"] == "before" || e["stage"] == "after" {
        let mut raw = if e["stepId"] == "status"
            || e["stepId"] == "identity"
            || e["stepId"] == "permission"
        {
            f["rawStatus"].clone()
        } else {
            baseline.clone()
        };
        if e["stepId"] != "config"
            && e["stepId"] != "status"
            && e["stepId"] != "identity"
            && e["stepId"] != "permission"
            && !(e["recipeRef"].as_str().unwrap_or("").starts_with("remove/")
                && e["stage"] == "after")
        {
            if let Some(port) = e["bindings"]["port"]["value"].as_u64() {
                let port = port.to_string();
                let host = e["bindings"]["dnsName"]["value"].as_str().unwrap();
                let placement = f["modes"][a["id"].as_str().unwrap()]["configPlacement"].as_str();
                let view = if placement == Some("foreground") {
                    raw["Foreground"]["owned-fixture"] =
                        json!({"TCP":{},"Web":{},"AllowFunnel":{}});
                    &mut raw["Foreground"]["owned-fixture"]
                } else {
                    &mut raw
                };
                view["TCP"][&port] = json!({"HTTPS":true});
                view["Web"][format!("{host}:{port}")] =
                    json!({"Handlers":{"/":{"Proxy":e["bindings"]["loopbackTarget"]["value"]}}});
                if a["audience"] == "public" {
                    view["AllowFunnel"][format!("{host}:{port}")] = json!(true);
                }
            }
        }
        let mut result = json!({"stdout":raw.to_string(),"exitCode":0,"observation":{"sessionId":"plan-fixture","authorityRef":"observer","observedAtMs":host["nowMs"],"expiresAtMs":100000}});
        if !out["state"]["resources"].as_array().unwrap().is_empty() {
            result["ownershipReceipt"] = receipt;
        }
        if e["recipeRef"] == "remove/ownership" {
            result.as_object_mut().unwrap().remove("stdout");
            result["details"] = e["ownership"]["details"].clone();
        }
        return result;
    }
    if e["operation"] == "remove" {
        return json!({"exitCode":0,"removed":true,"ownershipReceipt":receipt});
    }
    let mode = &f["modes"][a["id"].as_str().unwrap()];
    json!({"exitCode":0,"stdout":mode["stdout"].as_str().unwrap_or(""),"origin":mode["origin"],"ownership":{"handleRef":"fixture-resource","continuityRef":"fixture-continuity","kind":mode["ownershipKind"],"sessionId":"plan-fixture","generation":e["generation"],"details":expand(&a["recipes"]["create"]["ledger"],&e["bindings"])}})
}
fn until(mut out: Value, a: &Value, host: &Value, baseline: &Value, stop: &str) -> Value {
    for _ in 0..40 {
        if out["effects"].as_array().unwrap().is_empty() || out["effects"][0]["stage"] == stop {
            return out;
        }
        let r = response(&out, a, host, baseline);
        out = ack(&out, r, host);
    }
    panic!("plan did not stop within bound");
}
#[test]
fn normalized_first_five_native_plans_reach_receipt_gate() {
    let f = fixture();
    for name in ["private", "public", "process", "lan", "external"] {
        let a = definition(name);
        let out = until(
            begin(&a, &f["host"]),
            &a,
            &f["host"],
            &f["baselineConfig"],
            "health",
        );
        assert_eq!(
            out["snapshot"]["phase"], "candidate-ready",
            "{name}: {}",
            out["snapshot"]
        );
        assert!(out["snapshot"]["published"].is_null());
    }
}
#[test]
fn failed_and_expired_preflight_emit_no_mutation() {
    let f = fixture();
    let a = definition("private");
    let out = begin(&a, &f["host"]);
    let mut r = response(&out, &a, &f["host"], &f["baselineConfig"]);
    r["stdout"] = json!("{\"BackendState\":\"NeedsLogin\"}");
    let denied = ack(&out, r, &f["host"]);
    assert_eq!(denied["effects"], json!([]));
    let mut r = response(&out, &a, &f["host"], &f["baselineConfig"]);
    r["observation"]["expiresAtMs"] = json!(999);
    assert_eq!(ack(&out, r, &f["host"])["effects"], json!([]));
}
#[test]
fn durable_ack_cannot_execute_after_preflight_authority_expiry() {
    let f = fixture();
    let a = definition("private");
    let out = until(
        begin(&a, &f["host"]),
        &a,
        &f["host"],
        &f["baselineConfig"],
        "persist",
    );
    assert_eq!(out["effects"][0]["kind"], "persist");
    let mut late = f["host"].clone();
    late["nowMs"] = json!(100001);
    let denied = ack(&out, json!({"durable":true}), &late);
    assert_eq!(denied["effects"], json!([]));
}
#[test]
fn occupied_private_candidates_never_emit_intent() {
    let f = fixture();
    let a = definition("private");
    let mut baseline = f["baselineConfig"].clone();
    baseline["TCP"]["9444"] = json!({"HTTPS":true});
    baseline["TCP"]["9445"] = json!({"HTTPS":true});
    let out = until(begin(&a, &f["host"]), &a, &f["host"], &baseline, "persist");
    assert_eq!(out["effects"], json!([]));
    assert_eq!(out["state"]["resources"], json!([]));
}
#[test]
fn changed_identity_and_unknown_continuity_block_cleanup() {
    let f = fixture();
    let a = definition("private");
    let active = until(
        begin(&a, &f["host"]),
        &a,
        &f["host"],
        &f["baselineConfig"],
        "health",
    );
    let stopped = run(json!({"state":active["state"],"host":f["host"],"command":{"type":"stop"}}));
    assert_eq!(stopped["effects"][0]["recipeRef"], "remove/ownership");
    let mut inspection = response(&stopped, &a, &f["host"], &f["baselineConfig"]);
    inspection["ownershipReceipt"]["continuous"] = json!(false);
    assert_eq!(ack(&stopped, inspection, &f["host"])["effects"], json!([]));

    let inspection = response(&stopped, &a, &f["host"], &f["baselineConfig"]);
    let identity = ack(&stopped, inspection, &f["host"]);
    assert_eq!(
        identity["effects"][0]["recipeRef"],
        "remove/before/identity"
    );
    for pointer in [
        "/Self/ID",
        "/CurrentTailnet/MagicDNSSuffix",
    ] {
        let mut raw = f["rawStatus"].clone();
        *raw.pointer_mut(pointer).unwrap() = json!("changed-identity.example");
        let mut result = response(&identity, &a, &f["host"], &f["baselineConfig"]);
        result["stdout"] = json!(raw.to_string());
        let denied = ack(&identity, result, &f["host"]);
        assert_eq!(denied["effects"], json!([]));
        assert_eq!(denied["snapshot"]["phase"], "cleanup-pending");
        assert!(denied["snapshot"]["published"].is_null());
    }
}

#[test]
fn whole_map_capture_rejects_conflicts_that_omit_captured_leaves() {
    let f = fixture();
    let mut a = definition("private");
    // The existing record capture enforces cardinality before selecting fields.
    // Guard whole maps as well as their HTTPS/proxy leaves.
    a["recipes"]["create"]["after"][0]["captures"]["selectedListener"] =
        json!({"type":"record","pointer":"/Foreground/*/TCP/{port}","fields":{}});
    a["recipes"]["create"]["after"][0]["captures"]["selectedWeb"] =
        json!({"type":"record","pointer":"/Foreground/*/Web/{dnsName}:{port}","fields":{}});
    let readback = until(
        begin(&a, &f["host"]),
        &a,
        &f["host"],
        &f["baselineConfig"],
        "after",
    );
    for conflict in ["tcp", "web", "both"] {
        let mut result = response(&readback, &a, &f["host"], &f["baselineConfig"]);
        let mut raw: Value = serde_json::from_str(result["stdout"].as_str().unwrap()).unwrap();
        let bindings = &readback["effects"][0]["bindings"];
        let port = bindings["port"]["value"].as_u64().unwrap().to_string();
        let name = format!("{}:{port}", bindings["dnsName"]["value"].as_str().unwrap());
        raw["Foreground"]["foreign"] = json!({"TCP":{},"Web":{},"AllowFunnel":{}});
        if conflict != "web" {
            raw["Foreground"]["foreign"]["TCP"][&port] = json!({"TCPForward":"127.0.0.1:65534"});
        }
        if conflict != "tcp" {
            raw["Foreground"]["foreign"]["Web"][&name] =
                json!({"Handlers":{"/foreign":{"Text":"foreign"}}});
        }
        result["stdout"] = json!(raw.to_string());
        let denied = ack(&readback, result, &f["host"]);
        assert_eq!(denied["effects"], json!([]));
        assert_eq!(denied["snapshot"]["phase"], "cleanup-pending");
        assert!(denied["snapshot"]["candidate"].is_null());
        assert!(denied["snapshot"]["published"].is_null());
    }
}
#[test]
fn local_handle_remove_inspects_before_durable_intent() {
    let f = fixture();
    for name in ["process", "lan"] {
        let a = definition(name);
        let active = until(
            begin(&a, &f["host"]),
            &a,
            &f["host"],
            &f["baselineConfig"],
            "health",
        );
        let stop = run(json!({"state":active["state"],"host":f["host"],"command":{"type":"stop"}}));
        assert_eq!(stop["effects"][0]["recipeRef"], "remove/ownership");
        let done = until(stop, &a, &f["host"], &f["baselineConfig"], "health");
        assert_eq!(
            done["snapshot"]["phase"], "stopped",
            "{name} {}",
            done["snapshot"]
        );
    }
}
#[test]
fn health_expiry_and_rotation_withdraw_external_without_mutation() {
    let f = fixture();
    let a = definition("external");
    let ready = until(
        begin(&a, &f["host"]),
        &a,
        &f["host"],
        &f["baselineConfig"],
        "health",
    );
    let approved = run(
        json!({"state":ready["state"],"host":f["host"],"command":{"type":"approve-origin","generation":ready["state"]["generation"],"origin":ready["snapshot"]["candidate"]}}),
    );
    assert!(approved["snapshot"]["published"].is_string());
    let timer = ready["effects"][0].clone();
    let expired = run(
        json!({"state":approved["state"],"host":f["host"],"command":{"type":"effect-result","effectId":timer["id"],"sessionId":timer["sessionId"],"generation":timer["generation"],"ok":true,"result":{"elapsed":true}}}),
    );
    assert!(expired["snapshot"]["published"].is_null());
    let mut host = f["host"].clone();
    host["bindings"]["externalOrigin"]["value"] = json!("https://rotated.example");
    host["probe"]["nonceRef"] = json!("rotated-nonce");
    let rotated =
        run(json!({"state":expired["state"],"host":host,"command":{"type":"update-origin"}}));
    assert_eq!(rotated["effects"][0]["url"], "https://rotated.example");
    assert_eq!(
        rotated["state"]["generation"],
        json!(ready["state"]["generation"].as_u64().unwrap() + 1)
    );
    assert!(rotated["effects"]
        .as_array()
        .unwrap()
        .iter()
        .all(|e| e["operation"] != "create" && e["operation"] != "remove"));
}

#[test]
fn owned_process_route_rotation_uses_allocation_ledger_and_fresh_probe() {
    let f = fixture();
    let a = definition("process");
    let ready = until(
        begin(&a, &f["host"]),
        &a,
        &f["host"],
        &f["baselineConfig"],
        "health",
    );
    let resource = ready["state"]["resources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["ownership"] == "owned" && r["cleanup"] == "active")
        .unwrap();
    let mut host = f["host"].clone();
    host["nowMs"] = json!(1020);
    host["probe"]["nonceRef"] = json!("route-rotation-fresh-nonce");
    let rotated = run(json!({"state":ready["state"],"host":host,"command":{
        "type":"owned-process-origin", "sessionId":"plan-fixture", "adapterId":"localhost-run", "resourceId":resource["id"],
        "allocationGeneration":resource["generation"], "continuityRef":resource["ledger"]["continuityRef"],
        "origin":"https://replacement.lhr.life", "line":"A new address is https://replacement.lhr.life"
    }}));
    assert_eq!(rotated["snapshot"]["published"], Value::Null);
    assert_eq!(rotated["effects"][0]["url"], "https://replacement.lhr.life");
    assert_eq!(
        rotated["events"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["type"] == "route-change")
            .unwrap()["oldOrigin"],
        ready["snapshot"]["candidate"]
    );
    assert_eq!(
        rotated["snapshot"]["lastRouteChange"]["newOrigin"],
        "https://replacement.lhr.life"
    );
    let verified = ack(
        &rotated,
        response(&rotated, &a, &host, &f["baselineConfig"]),
        &host,
    );
    assert_eq!(verified["snapshot"]["phase"], "candidate-ready");
    assert_eq!(
        verified["snapshot"]["candidate"],
        "https://replacement.lhr.life"
    );
    let approved = run(json!({"state":verified["state"],"host":host,"command":{
        "type":"approve-origin", "generation":verified["snapshot"]["generation"],
        "origin":"https://replacement.lhr.life"
    }}));
    assert_eq!(
        approved["snapshot"]["published"],
        "https://replacement.lhr.life"
    );

    let rejected = run(json!({"state":ready["state"],"host":f["host"],"command":{
        "type":"owned-process-origin", "sessionId":"plan-fixture", "adapterId":"localhost-run", "resourceId":"foreign",
        "allocationGeneration":resource["generation"], "continuityRef":resource["ledger"]["continuityRef"],
        "origin":"https://replacement.lhr.life", "line":"A new address is https://replacement.lhr.life"
    }}));
    assert_eq!(
        rejected["snapshot"]["candidate"],
        ready["snapshot"]["candidate"]
    );
    assert!(rejected["effects"].as_array().unwrap().is_empty());

    let duplicate = run(json!({"state":ready["state"],"host":f["host"],"command":{
        "type":"owned-process-origin", "sessionId":"plan-fixture", "adapterId":"localhost-run", "resourceId":resource["id"],
        "allocationGeneration":resource["generation"], "continuityRef":resource["ledger"]["continuityRef"],
        "origin":ready["snapshot"]["candidate"], "line":ready["snapshot"]["candidate"]
    }}));
    assert_eq!(duplicate["effects"], json!([]));
    assert_eq!(
        duplicate["snapshot"]["candidate"],
        ready["snapshot"]["candidate"]
    );

    let multiple = run(json!({"state":ready["state"],"host":f["host"],"command":{
        "type":"owned-process-origin", "sessionId":"plan-fixture", "adapterId":"localhost-run", "resourceId":resource["id"],
        "allocationGeneration":resource["generation"], "continuityRef":resource["ledger"]["continuityRef"],
        "origin":"https://replacement.lhr.life", "line":"https://replacement.lhr.life https://foreign.lhr.life"
    }}));
    assert!(multiple["effects"].as_array().unwrap().is_empty());
    assert_eq!(
        multiple["snapshot"]["candidate"],
        ready["snapshot"]["candidate"]
    );

    let stopped = run(json!({"state":ready["state"],"host":f["host"],"command":{"type":"stop"}}));
    let after_stop = run(json!({"state":stopped["state"],"host":f["host"],"command":{
        "type":"owned-process-origin", "sessionId":"plan-fixture", "adapterId":"localhost-run", "resourceId":resource["id"],
        "allocationGeneration":resource["generation"], "continuityRef":resource["ledger"]["continuityRef"],
        "origin":"https://replacement.lhr.life", "line":"https://replacement.lhr.life"
    }}));
    assert!(after_stop["effects"].as_array().unwrap().is_empty());
    assert_eq!(after_stop["snapshot"]["published"], Value::Null);
}
#[test]
fn immutable_owned_origin_is_withdrawn_on_change_and_cannot_recover() {
    let f = fixture();
    let mut a = definition("process");
    a["originPolicy"] = json!("immutable");
    a["admission"]["requiredFeatures"]
        .as_array_mut()
        .unwrap()
        .push(json!("immutable-origin"));
    let mut host = f["host"].clone();
    host["features"]
        .as_array_mut()
        .unwrap()
        .push(json!("immutable-origin"));
    let ready = until(begin(&a, &host), &a, &host, &f["baselineConfig"], "health");
    let resource = ready["state"]["resources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["ownership"] == "owned" && r["cleanup"] == "active")
        .unwrap();
    let changed = run(json!({"state":ready["state"],"host":host,"command":{
        "type":"owned-process-origin", "sessionId":"plan-fixture", "adapterId":"localhost-run", "resourceId":resource["id"],
        "allocationGeneration":resource["generation"], "continuityRef":resource["ledger"]["continuityRef"],
        "origin":"https://replacement.lhr.life", "line":"https://replacement.lhr.life"
    }}));
    assert_eq!(changed["snapshot"]["published"], Value::Null);
    assert_eq!(changed["snapshot"]["candidate"], Value::Null);
    assert!(changed["effects"].as_array().unwrap().is_empty());
    let health = run(json!({"state":changed["state"],"host":host,"command":{"type":"health"}}));
    assert_eq!(health["snapshot"]["published"], Value::Null);
    assert!(health["effects"].as_array().unwrap().is_empty());
}
#[test]
fn malformed_json_origin_declarations_fail_before_create() {
    let f = fixture();
    let mut host = f["host"].clone();
    host["features"]
        .as_array_mut()
        .unwrap()
        .push(json!("json-event-origin"));
    for event in [
        json!({"eventPointer":"","eventValue":"tunnel","originPointer":"/url"}),
        json!({"eventPointer":"/event","eventValue":"","originPointer":"/url"}),
        json!({"eventPointer":"/event","eventValue":"tunnel","originPointer":"url"}),
    ] {
        let mut a = definition("process");
        a["admission"]["requiredFeatures"]
            .as_array_mut()
            .unwrap()
            .push(json!("json-event-origin"));
        a["recipes"]["create"]["parser"]["jsonEvent"] = event;
        let output = begin(&a, &host);
        assert!(output["effects"].as_array().unwrap().is_empty());
        assert_ne!(output["snapshot"]["phase"], "candidate-ready");
    }
}
#[test]
fn late_allocation_is_tracked_and_never_published() {
    let f = fixture();
    let a = definition("private");
    let create = until(
        begin(&a, &f["host"]),
        &a,
        &f["host"],
        &f["baselineConfig"],
        "execute",
    );
    let stopped = run(json!({"state":create["state"],"host":f["host"],"command":{"type":"stop"}}));
    let e = &create["effects"][0];
    let late = run(
        json!({"state":stopped["state"],"host":f["host"],"command":{"type":"effect-result","effectId":e["id"],"sessionId":e["sessionId"],"generation":e["generation"],"ok":true,"result":response(&create,&a,&f["host"],&f["baselineConfig"])}}),
    );
    assert_eq!(late["state"]["resources"][0]["cleanup"], "pending");
    assert!(late["snapshot"]["published"].is_null());
    assert!(late["effects"]
        .as_array()
        .unwrap()
        .iter()
        .all(|e| e["operation"] != "create"));
}
#[test]
fn known_mismatched_allocation_remains_explicit_owned_debt() {
    let f = fixture();
    let a = definition("private");
    let create = until(
        begin(&a, &f["host"]),
        &a,
        &f["host"],
        &f["baselineConfig"],
        "execute",
    );
    let mut r = response(&create, &a, &f["host"], &f["baselineConfig"]);
    r["ownership"]["details"]["proxy"] = json!("http://127.0.0.1:7000");
    let out = ack(&create, r, &f["host"]);
    assert_eq!(out["state"]["resources"][0]["id"], "fixture-resource");
    assert_eq!(out["state"]["resources"][0]["cleanup"], "pending");
    assert!(out["snapshot"]["published"].is_null());
}
#[test]
fn malformed_intermediate_listener_map_cannot_hide_occupied_ports() {
    let f = fixture();
    let a = definition("private");
    let mut baseline = f["baselineConfig"].clone();
    baseline["Foreground"] = json!("unknown-schema");
    let out = until(begin(&a, &f["host"]), &a, &f["host"], &baseline, "persist");
    assert_eq!(out["effects"], json!([]));
    assert_eq!(out["state"]["resources"], json!([]));
}
#[test]
fn pointer_binding_escapes_root_mount_in_raw_assertion() {
    let f = fixture();
    let mut a = definition("process");
    a["bindings"]["mount"] = json!({"type":"mount","value":"/"});
    a["recipes"]["create"]["before"] = json!([{"id":"check","recipe":{"kind":"spawn","program":"fixture-read","args":[],"parser":{"kind":"json-document","predicate":{"op":"exists","pointer":""}}},"assert":{"op":"equals","pointer":"/Handlers/{mount}/value","value":true}}]);
    let initial = begin(&a, &f["host"]);
    let result = json!({"stdout":"{\"Handlers\":{\"/\":{\"value\":true}}}","observation":{"sessionId":"plan-fixture","authorityRef":"fixture-read","observedAtMs":1000,"expiresAtMs":100000}});
    let out = ack(&initial, result, &f["host"]);
    assert_eq!(out["effects"][0]["kind"], "persist");
}
#[test]
fn public_route_remains_candidate_for_private_clients_and_observations_rank_it_honestly() {
    let f = fixture();
    let public = definition("external");
    for reach in ["tailnet", "lan", "this-device"] {
        let out = run(
            json!({"command":{"type":"recommend"},"adapters":[public],"requirements":{"clientReach":reach}}),
        );
        assert_eq!(out["snapshot"]["recommendations"], json!(["own-address"]));
        assert_eq!(
            out["snapshot"]["plans"][0]["eligibility"],
            "needs-validation"
        );
    }
    let mut out = run(
        json!({"command":{"type":"status"},"adapters":[definition("process"),definition("external")]}),
    );
    out["state"]["observations"] = json!({"localhost-run":"absent","own-address":"present"});
    let ranked = run(json!({"state":out["state"],"command":{"type":"recommend"}}));
    assert_eq!(ranked["snapshot"]["recommendations"][0], "own-address");
    assert_eq!(ranked["snapshot"]["plans"][1]["observation"], "absent");
    assert!(!ranked["snapshot"]["plans"][1]["preconditionActions"]
        .as_array()
        .unwrap()
        .is_empty());
    let _ = f;
}
fn public_relay_attempt(allow: bool, ip: &str, patch: Value) -> Value {
    let f = fixture();
    let a = definition("external");
    let mut host = f["host"].clone();
    host["probe"]["allowPublicRelay"] = json!(allow);
    let probe = begin(&a, &host);
    let mut r = response(&probe, &a, &host, &f["baselineConfig"]);
    let receipt = r["probeReceipt"].as_object_mut().unwrap();
    receipt.insert("remote".into(), json!(false));
    receipt.insert("networkPath".into(), json!("public-relay"));
    receipt.insert("publicDns".into(), json!(true));
    receipt.insert("resolvedIp".into(), json!(ip));
    for (key, value) in patch.as_object().unwrap() {
        receipt.insert(key.clone(), value.clone());
    }
    ack(&probe, r, &host)
}
#[test]
fn public_relay_accepts_only_explicitly_authorized_public_dns_path() {
    for ip in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
        let out = public_relay_attempt(true, ip, json!({}));
        assert_eq!(
            out["snapshot"]["phase"], "candidate-ready",
            "{ip}: {}",
            out["snapshot"]
        );
        assert!(out["snapshot"]["published"].is_null());
    }
    let out = public_relay_attempt(false, "1.1.1.1", json!({}));
    assert_eq!(out["snapshot"]["phase"], "degraded");
    for patch in [
        json!({"publicDns":false}),
        json!({"networkPath":"local"}),
        json!({"vantage":"lan"}),
        json!({"verifierRef":"wrong"}),
        json!({"nonceRef":"wrong"}),
        json!({"origin":"https://wrong.example"}),
        json!({"instanceMatched":false}),
        json!({"tls":false}),
    ] {
        assert_eq!(
            public_relay_attempt(true, "1.1.1.1", patch.clone())["snapshot"]["phase"],
            "degraded",
            "{patch}"
        );
    }
}
#[test]
fn public_relay_rejects_private_cgnat_and_other_nonpublic_addresses() {
    for ip in [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.1.1",
        "100.64.0.1",
        "100.127.255.254",
        "0.0.0.0",
        "192.0.2.1",
        "198.18.0.1",
        "198.51.100.1",
        "203.0.113.1",
        "224.0.0.1",
        "255.255.255.255",
        "::1",
        "::",
        "fe80::1",
        "fc00::1",
        "ff02::1",
        "::ffff:8.8.8.8",
        "2001:db8::1",
        "2002:0a00:0001::1",
        "3fff::1",
        "not-an-ip",
    ] {
        assert_eq!(
            public_relay_attempt(true, ip, json!({}))["snapshot"]["phase"],
            "degraded",
            "{ip}"
        );
    }
}
#[test]
fn public_relay_permission_is_bound_to_issued_probe_and_never_satisfies_private_vantage() {
    let f = fixture();
    let a = definition("external");
    let probe = begin(&a, &f["host"]);
    let mut host = f["host"].clone();
    host["probe"]["allowPublicRelay"] = json!(true);
    let mut r = response(&probe, &a, &host, &f["baselineConfig"]);
    r["probeReceipt"]["remote"] = json!(false);
    r["probeReceipt"]["networkPath"] = json!("public-relay");
    r["probeReceipt"]["publicDns"] = json!(true);
    r["probeReceipt"]["resolvedIp"] = json!("1.1.1.1");
    assert_eq!(ack(&probe, r, &host)["snapshot"]["phase"], "degraded");
    for mode in ["private", "lan"] {
        let a = definition(mode);
        let mut host = f["host"].clone();
        host["probe"]["allowPublicRelay"] = json!(true);
        let probe = until(begin(&a, &host), &a, &host, &f["baselineConfig"], "probe");
        let mut r = response(&probe, &a, &host, &f["baselineConfig"]);
        r["probeReceipt"]["remote"] = json!(false);
        r["probeReceipt"]["networkPath"] = json!("public-relay");
        r["probeReceipt"]["publicDns"] = json!(true);
        r["probeReceipt"]["resolvedIp"] = json!("1.1.1.1");
        assert_eq!(
            ack(&probe, r, &host)["snapshot"]["phase"],
            "degraded",
            "{mode}"
        );
    }
}

fn absent_cleanup_fixture() -> (Value, Value) {
    let f = fixture();
    let a = definition("public");
    let ready = until(
        begin(&a, &f["host"]),
        &a,
        &f["host"],
        &f["baselineConfig"],
        "health",
    );
    let stopped = run(json!({"state":ready["state"],"host":f["host"],"command":{"type":"stop"}}));
    let mut host = f["host"].clone();
    let resource = &stopped["state"]["resources"][0];
    host["cleanupAbsent"] = json!({"fixture-resource":{"sessionId":"plan-fixture","handleRef":resource["ledger"]["handleRef"],"continuityRef":resource["ledger"]["continuityRef"],"processGone":true,"providerAbsent":true,"observedAtMs":host["nowMs"],"expiresAtMs":100000}});
    (stopped, host)
}
#[test]
fn stopped_absent_process_retires_only_proven_allocation_and_can_restart() {
    let (stopped, host) = absent_cleanup_fixture();
    assert_eq!(stopped["snapshot"]["phase"], "cleanup-pending");
    let cleared = run(
        json!({"state":stopped["state"],"host":host,"command":{"type":"reconcile-absent","resourceId":"fixture-resource"}}),
    );
    assert_eq!(cleared["snapshot"]["phase"], "stopped");
    assert_eq!(cleared["state"]["resources"][0]["cleanup"], "removed");
    assert!(cleared["effects"].as_array().unwrap().is_empty());
    assert!(cleared["state"]["pending"]
        .as_object()
        .unwrap()
        .values()
        .all(|pending| pending["effect"]["operation"] == "health"));
    assert!(cleared["state"].get("execution").is_none());
    let restarted = run(
        json!({"state":cleared["state"],"host":host,"command":{"type":"start","adapterId":"tailscale-funnel","consent":true}}),
    );
    assert!(restarted["effects"][0]["recipeRef"]
        .as_str()
        .unwrap()
        .starts_with("create/"));
}
#[test]
fn absent_process_cleanup_rejects_unproven_scope_and_live_or_unknown_resources() {
    let (stopped, host) = absent_cleanup_fixture();
    for patch in [
        json!({"sessionId":"other"}),
        json!({"handleRef":"other"}),
        json!({"continuityRef":"other"}),
        json!({"processGone":false}),
        json!({"providerAbsent":false}),
        json!({"observedAtMs":100001}),
        json!({"expiresAtMs":0}),
        json!({"unknown":true}),
    ] {
        let mut h = host.clone();
        h["cleanupAbsent"]["fixture-resource"]
            .as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        let denied = run(
            json!({"state":stopped["state"],"host":h,"command":{"type":"reconcile-absent","resourceId":"fixture-resource"}}),
        );
        assert_eq!(denied["state"]["resources"], stopped["state"]["resources"]);
        assert_eq!(denied["state"]["pending"], stopped["state"]["pending"]);
        assert!(denied["effects"].as_array().unwrap().is_empty());
    }
    for (key, value) in [("stopRequested", json!(false)), ("resources", json!([]))] {
        let mut state = stopped["state"].clone();
        state[key] = value;
        let denied = run(
            json!({"state":state,"host":host,"command":{"type":"reconcile-absent","resourceId":"fixture-resource"}}),
        );
        assert_eq!(denied["state"]["resources"], state["resources"]);
    }
    let mut state = stopped["state"].clone();
    state["resources"][0]["ledger"]["kind"] = json!("route");
    let denied = run(
        json!({"state":state,"host":host,"command":{"type":"reconcile-absent","resourceId":"fixture-resource"}}),
    );
    assert_eq!(denied["state"]["resources"][0]["cleanup"], "pending");
}
#[test]
fn absent_cleanup_preserves_uncertain_creates_and_other_resource_debt() {
    let (mut stopped, host) = absent_cleanup_fixture();
    let pending = stopped["state"]["pending"]
        .as_object()
        .unwrap()
        .values()
        .next()
        .unwrap()
        .clone();
    let mut uncertain = pending.clone();
    uncertain["effect"]["operation"] = json!("create");
    stopped["state"]["pending"]["uncertain-create"] = uncertain;
    let mut other = stopped["state"]["resources"][0].clone();
    other["id"] = json!("other-resource");
    stopped["state"]["resources"]
        .as_array_mut()
        .unwrap()
        .push(other);
    let cleared = run(
        json!({"state":stopped["state"],"host":host,"command":{"type":"reconcile-absent","resourceId":"fixture-resource"}}),
    );
    assert_eq!(cleared["state"]["resources"][0]["cleanup"], "removed");
    assert_eq!(cleared["state"]["resources"][1]["cleanup"], "pending");
    assert_eq!(
        cleared["state"]["pending"]["uncertain-create"],
        stopped["state"]["pending"]["uncertain-create"]
    );
    assert_eq!(cleared["snapshot"]["phase"], "stopping");
    assert!(cleared["effects"].as_array().unwrap().is_empty());
}

fn nonce_budget_host(now: u64, nonce: &str) -> Value {
    let mut host = fixture()["host"].clone();
    host["nowMs"] = json!(now);
    host["probe"]["nonceRef"] = json!(nonce);
    host["probe"]["expiresAtMs"] = json!(now + 900_000);
    host["probe"]["allowPublicRelay"] = json!(true);
    host
}
fn nonce_budget_receipt(probe: &Value, host: &Value) -> Value {
    json!({"probeReceipt":{
        "nonceRef":host["probe"]["nonceRef"], "verifierRef":host["probe"]["verifierRef"],
        "origin":probe["effects"][0]["url"], "vantage":"public",
        "observedAtMs":host["nowMs"], "expiresAtMs":host["nowMs"].as_u64().unwrap()+30_000,
        "tls":true,"instanceMatched":true,"sse":true,"streamableHttp":true,"oauthDcr":true,
        "remote":false,"networkPath":"public-relay","publicDns":true,"resolvedIp":"1.1.1.1"
    }})
}
fn nonce_budget_publish(probe: &Value, host: &Value) -> (Value, Value) {
    assert_eq!(probe["effects"][0]["kind"], "http-probe", "{probe}");
    let ready = ack(probe, nonce_budget_receipt(probe, host), host);
    assert_eq!(ready["snapshot"]["phase"], "candidate-ready", "{ready}");
    let timer = ready["effects"][0].clone();
    let published = run(json!({"state":ready["state"],"host":host,"command":{
        "type":"approve-origin","generation":ready["state"]["generation"],
        "origin":ready["snapshot"]["candidate"]
    }}));
    assert_eq!(
        published["snapshot"]["phase"], "published-ready",
        "{published}"
    );
    assert!(published["snapshot"]["published"].is_string());
    (published, timer)
}
fn nonce_budget_retire_timer(state: &Value, timer: &Value, host: &Value) -> Value {
    run(json!({"state":state,"host":host,"command":{
        "type":"effect-result","effectId":timer["id"],"sessionId":timer["sessionId"],
        "generation":timer["generation"],"ok":true,"result":{"elapsed":true}
    }}))
}
#[test]
fn health_nonce_budget_publishes_for_eighty_minutes() {
    let a = definition("external");
    let host = nonce_budget_host(1000, "initial");
    let initial = begin(&a, &host);
    let (mut out, mut timer) = nonce_budget_publish(&initial, &host);
    for refresh in 1..=160_u64 {
        let host = nonce_budget_host(1000 + refresh * 30_000, &format!("refresh-{refresh}"));
        let probe = run(json!({"state":out["state"],"host":host,"command":{"type":"health"}}));
        assert_eq!(
            probe["effects"][0]["kind"], "http-probe",
            "refresh {refresh}: {probe}"
        );
        // Deliver the superseded timer, as a real host does when cancelling it.
        let retired = nonce_budget_retire_timer(&probe["state"], &timer, &host);
        let mut pending = probe.clone();
        pending["state"] = retired["state"].clone();
        (out, timer) = nonce_budget_publish(&pending, &host);
        let nonces = out["state"]["usedNonces"].as_array().unwrap();
        assert!(nonces.len() <= 128, "refresh {refresh}: {nonces:?}");
        if let Some(expiries) = out["state"]["usedNonceExpiries"].as_object() {
            assert!(nonces.len() <= 30, "refresh {refresh}: {nonces:?}");
            assert_eq!(expiries.len(), nonces.len());
            for nonce in nonces {
                assert!(
                    expiries[nonce.as_str().unwrap()].as_u64().unwrap()
                        > host["nowMs"].as_u64().unwrap()
                );
            }
        }
    }
    assert_eq!(
        out["state"]["usedNonceExpiries"].as_object().unwrap().len(),
        30
    );
}
#[test]
fn nonce_retirement_uses_original_authorization_not_new_deadline_or_receipt_expiry() {
    let a = definition("external");
    let host = nonce_budget_host(1000, "original");
    let initial = begin(&a, &host);
    let (out, _) = nonce_budget_publish(&initial, &host);
    // Receipt expired at 31000, but this nonce remains reserved until 901000.
    for deadline in [31_002_u64, 1_801_000] {
        let mut changed = nonce_budget_host(31_001, "original");
        changed["probe"]["expiresAtMs"] = json!(deadline);
        let denied = run(json!({"state":out["state"],"host":changed,"command":{"type":"health"}}));
        assert_eq!(denied["effects"], json!([]));
        assert!(denied["snapshot"]["published"].is_null());
        assert_eq!(denied["state"]["usedNonceExpiries"]["original"], 901_000);
        assert!(denied["state"]["limitations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v.as_str().unwrap().contains("already used")));
    }
    let mut expired = nonce_budget_host(901_000, "original");
    expired["probe"]["expiresAtMs"] = json!(901_000);
    let denied = run(json!({"state":out["state"],"host":expired,"command":{"type":"health"}}));
    assert_eq!(denied["effects"], json!([]));
    let fresh = nonce_budget_host(901_000, "fresh");
    let probe = run(json!({"state":out["state"],"host":fresh,"command":{"type":"health"}}));
    let (renewed, _) = nonce_budget_publish(&probe, &fresh);
    assert_eq!(renewed["state"]["usedNonces"], json!(["fresh"]));
    assert_eq!(
        renewed["state"]["usedNonceExpiries"]
            .as_object()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn nonce_budget_rejects_replayed_receipts_and_wrong_generation() {
    let a = definition("external");
    let host = nonce_budget_host(1000, "first");
    let initial = begin(&a, &host);
    let old_receipt = nonce_budget_receipt(&initial, &host);
    let (out, _) = nonce_budget_publish(&initial, &host);
    let fresh = nonce_budget_host(1001, "second");
    let probe = run(json!({"state":out["state"],"host":fresh,"command":{"type":"health"}}));
    assert_eq!(
        ack(&probe, old_receipt.clone(), &fresh)["snapshot"]["phase"],
        "degraded"
    );
    let e = &probe["effects"][0];
    let wrong = run(json!({"state":probe["state"],"host":fresh,"command":{
        "type":"effect-result","effectId":e["id"],"sessionId":e["sessionId"],
        "generation":initial["effects"][0]["generation"],"ok":true,
        "result":nonce_budget_receipt(&probe, &fresh)
    }}));
    assert!(wrong["snapshot"]["published"].is_null());
    assert!(wrong["state"]["pending"]
        .get(e["id"].as_str().unwrap())
        .is_some());
    let (published, _) = nonce_budget_publish(&probe, &fresh);
    let duplicate = run(json!({"state":published["state"],"host":fresh,"command":{
        "type":"effect-result","effectId":initial["effects"][0]["id"],
        "sessionId":initial["effects"][0]["sessionId"],
        "generation":initial["effects"][0]["generation"],"ok":true,"result":old_receipt
    }}));
    assert_eq!(duplicate["state"], published["state"]);
    // After retirement, an old receipt is expired even if its nonce is reissued.
    let later = nonce_budget_host(901_000, "first");
    let probe = run(json!({"state":out["state"],"host":later,"command":{"type":"health"}}));
    assert_eq!(probe["effects"][0]["kind"], "http-probe");
    assert_eq!(
        ack(&probe, nonce_budget_receipt(&initial, &host), &later)["snapshot"]["phase"],
        "degraded"
    );
}
#[test]
fn nonce_budget_keeps_128_live_and_legacy_entries_fail_closed() {
    let a = definition("external");
    let host = nonce_budget_host(1000, "initial");
    let (mut out, _) = nonce_budget_publish(&begin(&a, &host), &host);
    for i in 1..128 {
        let next = nonce_budget_host(1000, &format!("live-{i}"));
        let probe = run(json!({"state":out["state"],"host":next,"command":{"type":"health"}}));
        (out, _) = nonce_budget_publish(&probe, &next);
    }
    let extra = nonce_budget_host(1000, "extra");
    let denied = run(json!({"state":out["state"],"host":extra,"command":{"type":"health"}}));
    assert_eq!(denied["effects"], json!([]));
    assert!(denied["snapshot"]["published"].is_null());
    assert_eq!(denied["state"]["usedNonces"].as_array().unwrap().len(), 128);
    assert_eq!(
        denied["state"]["usedNonceExpiries"]
            .as_object()
            .unwrap()
            .len(),
        128
    );
    let later = nonce_budget_host(901_000, "after-expiry");
    let probe = run(json!({"state":out["state"],"host":later,"command":{"type":"health"}}));
    let (renewed, _) = nonce_budget_publish(&probe, &later);
    assert_eq!(renewed["state"]["usedNonces"], json!(["after-expiry"]));
    let mut legacy = out["state"].clone();
    legacy.as_object_mut().unwrap().remove("usedNonceExpiries");
    let denied = run(json!({"state":legacy,"host":later,"command":{"type":"health"}}));
    assert_eq!(denied["effects"], json!([]));
    assert_eq!(denied["state"]["usedNonces"].as_array().unwrap().len(), 128);
    assert!(denied["snapshot"]["published"].is_null());
}

#[test]
fn retired_nonce_rejects_old_receipt_even_when_receipt_claims_later_expiry() {
    let a = definition("external");
    let host = nonce_budget_host(1000, "reused");
    let initial = begin(&a, &host);
    let mut old_receipt = nonce_budget_receipt(&initial, &host);
    old_receipt["probeReceipt"]["expiresAtMs"] = json!(2_000_000);
    let ready = ack(&initial, old_receipt.clone(), &host);
    assert_eq!(ready["snapshot"]["phase"], "candidate-ready");
    assert_eq!(ready["state"]["healthExpiry"], 901_000);
    let mut later = nonce_budget_host(901_000, "reused");
    // A caller cannot backdate the core-owned issuance fence.
    later["probe"]["issuedAtMs"] = json!(0);
    let probe = run(json!({"state":ready["state"],"host":later,"command":{"type":"health"}}));
    assert_eq!(probe["effects"][0]["kind"], "http-probe");
    assert_eq!(probe["effects"][0]["probe"]["issuedAtMs"], 901_000);
    let denied = ack(&probe, old_receipt, &later);
    assert_eq!(denied["snapshot"]["phase"], "degraded");
    assert!(denied["snapshot"]["published"].is_null());
    // A receipt observed at this issuance time still succeeds.
    let (published, _) = nonce_budget_publish(&probe, &later);
    assert!(published["snapshot"]["published"].is_string());
}

#[test]
fn public_relay_health_stays_publishable_for_eighty_minutes_past_nonce_budget() {
    let f = fixture();
    let a = definition("process");
    let mut host = f["host"].clone();
    let mut out = until(begin(&a, &host), &a, &host, &f["baselineConfig"], "health");
    out = run(
        json!({"state":out["state"],"host":host,"command":{"type":"approve-origin","generation":out["state"]["generation"],"origin":out["snapshot"]["candidate"]}}),
    );
    let original = out["snapshot"]["published"].clone();
    assert!(original.is_string());
    for refresh in 1..=160 {
        let now = 1000 + refresh * 30_000;
        host["nowMs"] = json!(now);
        host["probe"]["nonceRef"] = json!(format!("health-proof-{refresh}"));
        host["probe"]["expiresAtMs"] = json!(now + 30_000);
        out = run(json!({"state":out["state"],"host":host,"command":{"type":"health"}}));
        assert_eq!(
            out["effects"][0]["kind"], "http-probe",
            "refresh {refresh}: {out}"
        );
        let receipt = json!({"nonceRef":host["probe"]["nonceRef"],"verifierRef":host["probe"]["verifierRef"],"origin":original,"vantage":"public","observedAtMs":now,"expiresAtMs":now+30_000,"tls":true,"instanceMatched":true,"sse":true,"streamableHttp":true,"oauthDcr":true,"remote":true});
        out = ack(&out, json!({"probeReceipt":receipt}), &host);
        out = run(
            json!({"state":out["state"],"host":host,"command":{"type":"approve-origin","generation":out["state"]["generation"],"origin":original}}),
        );
        assert_eq!(
            out["snapshot"]["published"], original,
            "refresh {refresh}: {out}"
        );
    }
}
