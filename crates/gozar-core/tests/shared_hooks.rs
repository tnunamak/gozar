use serde_json::{json, Value};
fn step(input: Value) -> Value {
    serde_json::from_str(&gozar_core::step(&input.to_string())).unwrap()
}
fn fixture(scheme: &str) -> (Value, Value) {
    let endpoint = json!({"scheme":scheme,"hostname":"endpoint.example","port":443,"endpointName":"fixture-endpoint"});
    let upstream = json!({"scheme":"http","hostname":"127.0.0.1","port":53123});
    let exact = json!({"credentialRef":"{credential}","endpoint":"{endpoint}"});
    let verified = json!({"op":"verified","fact":"credential-scope","value":exact});
    let mut mapping = json!({"op":"transport-mapping","fact":"transport-scope","endpoint":"{endpoint}","upstream":upstream,"policyRef":"fixture-policy"});
    if scheme == "https" {
        mapping["origin"] = json!("https://endpoint.example");
    }
    let features = json!([
        "recipe-sequence",
        "typed-bindings",
        "owned-resource-ledger",
        "owned-process",
        "private-file-reference",
        "private-file-materialization",
        "transport-origin-mapping",
        "probe-assertions",
        "client-vantage-probe"
    ]);
    let adapter = json!({"id":"fixture","audience":"public","ownership":"owned","planVersion":1,"admission":{"state":"admitted","requiredFeatures":features},"bindings":{
        "credential":{"type":"credential-reference"},"endpoint":{"type":"transport-endpoint"},
        "privateFile":{"type":"session-private-path","materialize":{"format":"json","template":{"token":{"kind":"credential-ref","binding":"credential"}},"credentialRefs":["credential"],"requires":[verified]}}
    },"recipes":{"create":{"kind":"spawn","program":"fixture-only","args":["--config","{privateFile}"],"parser":{"kind":"exit-code"},"process":{"mode":"owned-long-running","stdin":"closed","lifetimeMs":900000},"ledger":{"endpoint":"{endpoint}"},"requires":[verified,mapping,{"op":"private-file","binding":"privateFile","mode":"0600","parentMode":"0700"}]},"remove":{"kind":"owned-process","resourceId":"{resourceId}","signal":"SIGTERM","graceMs":100,"thenSignal":"SIGKILL","confirmExit":true,"requires":[{"op":"owned-ledger-match","source":"ownership","pointer":"/route"}]}}});
    let mut adapter = adapter;
    if scheme == "https" {
        adapter["endpointTemplate"] = json!("https://endpoint.example");
    }
    let scope = json!({"sessionId":"hooks","generation":1,"authorityRef":"fixture-authority","observedAtMs":1000,"expiresAtMs":10000});
    let mut credential = scope.clone();
    credential["type"] = json!("credential-reference");
    credential["handleRef"] = json!("credential-handle");
    let mut file = scope.clone();
    file["type"] = json!("session-private-path");
    file["handleRef"] = json!("file-handle");
    file["mode"] = json!("0600");
    file["parentMode"] = json!("0700");
    file["materialization"] = json!({"credentialRefs":{"credential":"credential-handle"}});
    let mut endpoint_binding = scope.clone();
    endpoint_binding["type"] = json!("transport-endpoint");
    endpoint_binding["value"] = endpoint.clone();
    let mut credential_fact = scope.clone();
    credential_fact["value"] = json!({"credentialRef":"credential-handle","endpoint":endpoint});
    let mut mapping_fact = scope.clone();
    mapping_fact["value"] =
        json!({"endpoint":endpoint,"upstream":upstream,"policyRef":"fixture-policy"});
    if scheme == "https" {
        mapping_fact["value"]["origin"] = json!("https://endpoint.example");
    }
    let host = json!({"nowMs":1000,"features":features,"bindings":{"credential":credential,"privateFile":file,"endpoint":endpoint_binding},"facts":{"credential-scope":credential_fact,"transport-scope":mapping_fact},"probe":{"nonceRef":"fixture-nonce","verifierRef":"fixture-verifier","expiresAtMs":10000}});
    (adapter, host)
}
fn start(adapter: &Value, host: &Value) -> Value {
    step(
        json!({"adapters":[adapter],"host":host,"command":{"type":"start","sessionId":"hooks","adapterId":"fixture","consent":true},"requirements":{"clientReach":"internet"}}),
    )
}
fn ack(output: &Value, host: &Value, result: Value) -> Value {
    let effect = &output["effects"][0];
    step(
        json!({"state":output["state"],"host":host,"command":{"type":"effect-result","effectId":effect["id"],"sessionId":effect["sessionId"],"generation":effect["generation"],"ok":true,"result":result}}),
    )
}
#[test]
fn exact_materialized_file_and_transport_authority_reach_spawn_without_secrets() {
    let (adapter, host) = fixture("https");
    let intent = start(&adapter, &host);
    assert_eq!(intent["effects"][0]["kind"], "persist", "{intent}");
    let spawn = ack(&intent, &host, json!({"durable":true}));
    assert_eq!(spawn["effects"][0]["kind"], "spawn", "{spawn}");
    assert_eq!(
        spawn["effects"][0]["args"],
        json!(["--config", "{privateFile}"])
    );
    assert!(!spawn.to_string().contains("/private/"));
}
#[test]
fn private_and_transport_receipts_fail_before_intent_for_scope_identity_or_mode_mismatch() {
    let (adapter, host) = fixture("https");
    for pointer in [
        "/bindings/credential/generation",
        "/bindings/endpoint/generation",
        "/bindings/privateFile/generation",
        "/facts/credential-scope/generation",
        "/facts/transport-scope/generation",
        "/bindings/credential/expiresAtMs",
        "/bindings/privateFile/expiresAtMs",
    ] {
        let mut wrong = host.clone();
        *wrong.pointer_mut(pointer).unwrap() = json!(0);
        assert_eq!(start(&adapter, &wrong)["effects"], json!([]), "{pointer}");
    }
    for (pointer, value) in [
        (
            "/bindings/privateFile/materialization/credentialRefs/credential",
            json!("different-handle"),
        ),
        ("/bindings/privateFile/mode", json!("0644")),
        (
            "/facts/credential-scope/value/credentialRef",
            json!("different-handle"),
        ),
        ("/facts/transport-scope/value/upstream/port", json!(53124)),
        (
            "/facts/transport-scope/value/policyRef",
            json!("different-policy"),
        ),
        ("/facts/transport-scope/value/endpoint/scheme", json!("tls")),
        ("/facts/transport-scope/sessionId", json!("other-session")),
    ] {
        let mut wrong = host.clone();
        *wrong.pointer_mut(pointer).unwrap() = value;
        assert_eq!(start(&adapter, &wrong)["effects"], json!([]), "{pointer}");
    }
    for missing in ["private-file-materialization", "transport-origin-mapping"] {
        let mut wrong = host.clone();
        wrong["features"]
            .as_array_mut()
            .unwrap()
            .retain(|feature| feature != missing);
        assert_eq!(start(&adapter, &wrong)["effects"], json!([]));
    }
}
#[test]
fn authority_changes_while_persisting_block_spawn() {
    let (adapter, host) = fixture("https");
    let intent = start(&adapter, &host);
    for (pointer, value) in [
        ("/bindings/privateFile/mode", json!("0644")),
        ("/bindings/privateFile/generation", json!(2)),
        (
            "/bindings/privateFile/materialization/credentialRefs/credential",
            json!("changed-handle"),
        ),
        (
            "/facts/transport-scope/value/policyRef",
            json!("changed-policy"),
        ),
    ] {
        let mut wrong = host.clone();
        *wrong.pointer_mut(pointer).unwrap() = value;
        let blocked = ack(&intent, &wrong, json!({"durable":true}));
        assert_eq!(blocked["effects"], json!([]), "{pointer}");
    }
}
#[test]
fn credential_bytes_and_paths_are_rejected_without_echoing_them_into_state() {
    let (adapter, mut host) = fixture("https");
    host["bindings"]["credential"]["value"] = json!("SECRET_BODY_SENTINEL");
    let rejected = start(&adapter, &host);
    assert!(rejected.get("error").is_some());
    assert!(!rejected.to_string().contains("SECRET_BODY_SENTINEL"));
    assert!(rejected.get("state").is_none());
}
#[test]
fn tls_and_tcp_endpoints_never_become_https_candidates() {
    for scheme in ["tls", "tcp"] {
        let (mut adapter, host) = fixture(scheme);
        adapter["endpointTemplate"] = json!("https://endpoint.example");
        assert_eq!(start(&adapter, &host)["effects"], json!([]));
        adapter.as_object_mut().unwrap().remove("endpointTemplate");
        let intent = start(&adapter, &host);
        let spawn = ack(&intent, &host, json!({"durable":true}));
        let done = ack(
            &spawn,
            &host,
            json!({"exitCode":0,"ownership":{"handleRef":"owned-fixture","continuityRef":"fixture-continuity","kind":"process","sessionId":"hooks","generation":1,"details":{"endpoint":host["bindings"]["endpoint"]["value"]}}}),
        );
        assert_eq!(done["snapshot"]["phase"], "transport-ready", "{done}");
        assert!(done["snapshot"]["candidate"].is_null());
        assert_eq!(done["effects"], json!([]));
    }
}

#[test]
fn transport_bindings_cannot_skip_or_hide_mapping_guards() {
    let (adapter, host) = fixture("https");
    let mut no_mapping = adapter.clone();
    no_mapping["recipes"]["create"]["requires"]
        .as_array_mut()
        .unwrap()
        .remove(1);
    assert_eq!(start(&no_mapping, &host)["effects"], json!([]));
    let mut hidden = adapter.clone();
    let mapping = hidden["recipes"]["create"]["requires"][1].clone();
    hidden["recipes"]["create"]["requires"][1] = json!({"op":"all","items":[mapping]});
    assert_eq!(start(&hidden, &host)["effects"], json!([]));
    let mut unrelated = adapter.clone();
    unrelated["recipes"]["create"]["requires"][1]["endpoint"] =
        json!({"scheme":"https","hostname":"other.example","port":443,"endpointName":"different"});
    assert_eq!(start(&unrelated, &host)["effects"], json!([]));
}

#[test]
fn mapping_cannot_bypass_an_approved_loopback_target() {
    let (mut adapter, mut host) = fixture("https");
    adapter["bindings"]["gatePort"] = json!({"type":"loopback-port"});
    host["bindings"]["gatePort"] = json!({"type":"loopback-port","value":53123,"authorityRef":"fixture-port","sessionId":"hooks","generation":1,"observedAtMs":1000,"expiresAtMs":10000});
    assert_eq!(start(&adapter, &host)["effects"][0]["kind"], "persist");
    let intent = start(&adapter, &host);
    assert_eq!(
        ack(&intent, &host, json!({"durable":true}))["effects"][0]["kind"],
        "spawn"
    );
    for upstream in [
        json!({"scheme":"http","hostname":"other.example","port":53123}),
        json!({"scheme":"http","hostname":"127.0.0.1","port":53124}),
    ] {
        let mut wrong = adapter.clone();
        let mut authority = host.clone();
        wrong["recipes"]["create"]["requires"][1]["upstream"] = upstream.clone();
        authority["facts"]["transport-scope"]["value"]["upstream"] = upstream;
        assert_eq!(start(&wrong, &authority)["effects"], json!([]));
    }
}

#[test]
fn expired_private_create_authority_does_not_block_exact_owned_cleanup() {
    let (mut adapter, mut host) = fixture("https");
    adapter["bindings"]["legacyPort"] = json!({"type":"loopback-port"});
    adapter["bindings"]["legacyHostFile"] = json!({"type":"session-private-path"});
    host["bindings"]["legacyPort"] = json!({"type":"loopback-port","value":53123,"authorityRef":"fixture-port","sessionId":"hooks","observedAtMs":1000,"expiresAtMs":10000});
    host["bindings"]["legacyHostFile"] = json!({"type":"session-private-path","handleRef":"legacy-file-handle","mode":"0600","parentMode":"0700","authorityRef":"fixture-host-file","sessionId":"hooks","observedAtMs":1000,"expiresAtMs":10000});
    let intent = start(&adapter, &host);
    let spawn = ack(&intent, &host, json!({"durable":true}));
    let allocated = ack(
        &spawn,
        &host,
        json!({"exitCode":0,"ownership":{"handleRef":"owned-fixture","continuityRef":"fixture-continuity","kind":"process","sessionId":"hooks","generation":1,"details":{"endpoint":host["bindings"]["endpoint"]["value"]}}}),
    );
    let mut expired = host.clone();
    expired["nowMs"] = json!(10001);
    expired["facts"] = json!({});
    expired["bindings"] = json!({});
    let stop = step(json!({"state":allocated["state"],"host":expired,"command":{"type":"stop"}}));
    assert_eq!(
        stop["effects"][0]["recipeRef"], "remove/ownership",
        "{stop}"
    );
    let receipt = json!({"handleRef":"owned-fixture","continuityRef":"fixture-continuity","sessionId":"hooks","observedAtMs":10001,"expiresAtMs":20000,"continuous":true});
    let checked = ack(
        &stop,
        &expired,
        json!({"details":allocated["state"]["resources"][0]["ledger"]["details"],"ownershipReceipt":receipt,"observation":{"sessionId":"hooks","authorityRef":"fixture-observer","observedAtMs":10001,"expiresAtMs":20000}}),
    );
    assert_eq!(checked["effects"][0]["kind"], "persist", "{checked}");
    let removing = ack(&checked, &expired, json!({"durable":true}));
    assert_eq!(
        removing["effects"][0]["kind"], "owned-process",
        "{removing}"
    );
    let stopped = ack(
        &removing,
        &expired,
        json!({"exitCode":0,"removed":true,"ownershipReceipt":receipt}),
    );
    assert_eq!(stopped["snapshot"]["phase"], "stopped", "{stopped}");
}
