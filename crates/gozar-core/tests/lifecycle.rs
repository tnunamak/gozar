use serde_json::{json, Value};
fn run(state: Option<&Value>, command: Value) -> Value {
    serde_json::from_str(&gozar_core::step(
        &json!({"state":state.cloned().unwrap_or_else(initial),"command":command}).to_string(),
    ))
    .unwrap()
}
fn initial() -> Value {
    let v:Value=serde_json::from_str(&gozar_core::step(&json!({"command":{"type":"status","sessionId":"test-session"},"adapters":[adapter("a","public","owned")],"requirements":{"clientReach":"internet"}}).to_string())).unwrap();
    v["state"].clone()
}
fn adapter(id: &str, audience: &str, ownership: &str) -> Value {
    json!({"id":id,"audience":audience,"ownership":ownership,"endpoint":"https://existing.example","capabilities":{"https":true,"sse":true,"streamableHttp":true},"recipes":{"detect":{"kind":"spawn","program":"ssh","args":["-V"],"parser":{"kind":"contains","value":"OpenSSH"}},"create":{"kind":"spawn","program":"fake","args":[],"parser":{"kind":"url"}},"remove":{"kind":"spawn","program":"fake","args":["{resourceId}"]}}})
}
fn finish(v: &Value, index: usize, ok: bool, result: Value) -> Value {
    let e = &v["effects"][index];
    run(
        Some(&v["state"]),
        json!({"type":"effect-result","effectId":e["id"],"sessionId":e["sessionId"],"generation":e["generation"],"ok":ok,"result":result}),
    )
}
fn starting() -> Value {
    let v = run(None, json!({"type":"start","adapterId":"a","consent":true}));
    assert_eq!(v["effects"][0]["kind"], "persist");
    finish(&v, 0, true, json!({"durable":true}))
}
fn validating() -> Value {
    finish(
        &starting(),
        0,
        true,
        json!({"stdout":"forward at https://route.example/secret?token=secret","exitCode":0,"resourceId":"owned-r1"}),
    )
}
#[test]
fn generic_detection_is_parsed_without_retaining_raw_output() {
    let v = run(None, json!({"type":"detect"}));
    assert_eq!(v["effects"][0]["program"], "ssh");
    assert_eq!(v["effects"][0]["args"], json!(["-V"]));
    let done = finish(
        &v,
        0,
        true,
        json!({"stderr":"OpenSSH_9.2 example-super-secret","exitCode":0}),
    );
    assert_eq!(done["snapshot"]["observations"]["a"], "present");
    assert!(!done.to_string().contains("example-super-secret"));
}
#[test]
fn durable_ack_is_required_before_create() {
    let v = run(None, json!({"type":"start","adapterId":"a","consent":true}));
    assert_eq!(v["effects"][0]["kind"], "persist");
    let done = finish(&v, 0, true, json!({}));
    assert_eq!(done["effects"], json!([]));
    assert_eq!(done["snapshot"]["phase"], "failed");
}
#[test]
fn stale_callback_path_cannot_publish() {
    // Shortest naive model path: start -> create -> probe -> stop -> late probe -> approve.
    let v = validating();
    let probe = &v["effects"][0];
    let stopped = run(Some(&v["state"]), json!({"type":"stop"}));
    let late = run(
        Some(&stopped["state"]),
        json!({"type":"effect-result","effectId":probe["id"],"sessionId":probe["sessionId"],"generation":probe["generation"],"ok":true,"result":{"status":200,"vantage":"public"}}),
    );
    let approved = run(
        Some(&late["state"]),
        json!({"type":"approve-origin","origin":"https://route.example","generation":late["state"]["generation"]}),
    );
    assert!(approved["snapshot"]["published"].is_null());
    assert_ne!(approved["snapshot"]["phase"], "candidate-ready");
}
#[test]
fn late_create_records_cleanup_debt_and_removes_only_after_durable_ack() {
    // Shortest naive model path: start -> stop before create returns -> late create.
    let v = starting();
    let create = &v["effects"][0];
    let stopped = run(Some(&v["state"]), json!({"type":"stop"}));
    let late = run(
        Some(&stopped["state"]),
        json!({"type":"effect-result","effectId":create["id"],"sessionId":create["sessionId"],"generation":create["generation"],"ok":true,"result":{"stdout":"https://route.example","resourceId":"r1"}}),
    );
    assert_eq!(late["snapshot"]["resources"][0]["cleanup"], "pending");
    assert_eq!(late["effects"][0]["kind"], "persist");
    let remove = finish(&late, 0, true, json!({"durable":true}));
    assert_eq!(remove["effects"][0]["operation"], "remove");
    assert_eq!(remove["effects"][0]["args"], json!(["r1"]));
    let done = finish(&remove, 0, true, json!({"exitCode":0}));
    assert_eq!(done["snapshot"]["phase"], "stopped");
    let again = run(Some(&done["state"]), json!({"type":"stop"}));
    assert_eq!(again["effects"], json!([]));
    assert_eq!(again["state"], done["state"]);
}
#[test]
fn stopping_external_owned_never_creates_or_removes() {
    let v:Value=serde_json::from_str(&gozar_core::step(&json!({"command":{"type":"start","adapterId":"foreign","consent":true},"adapters":[adapter("foreign","public","external-owned")],"requirements":{"clientReach":"internet"}}).to_string())).unwrap();
    assert_eq!(v["effects"][0]["kind"], "http-probe");
    let done = run(Some(&v["state"]), json!({"type":"stop"}));
    assert_eq!(done["effects"], json!([]));
    assert_eq!(done["state"]["resources"], json!([]));
}
#[test]
fn reach_and_required_capabilities_filter_recommendations() {
    for (reach, expected) in [
        ("internet", "public"),
        ("unknown", "public"),
        ("tailnet", "tailnet"),
        ("lan", "lan"),
        ("this-device", "local"),
    ] {
        let v:Value=serde_json::from_str(&gozar_core::step(&json!({"command":{"type":"recommend"},"adapters":[adapter("public","public","owned"),adapter("tailnet","tailnet","owned"),adapter("lan","lan","owned"),adapter("local","local","owned")],"requirements":{"clientReach":reach,"sse":true}}).to_string())).unwrap();
        let wanted = match reach {
            "internet" | "unknown" => json!(["public"]),
            "tailnet" => json!(["public", "tailnet"]),
            "lan" => json!(["public", "lan"]),
            _ => json!(["public", "tailnet", "lan", "local"]),
        };
        assert_eq!(
            v["snapshot"]["recommendations"], wanted,
            "{reach} allows {expected} plus compatible public routes"
        );
    }
    let v:Value=serde_json::from_str(&gozar_core::step(&json!({"command":{"type":"recommend"},"adapters":[adapter("a","public","owned")],"requirements":{"clientReach":"internet","oauthDcr":true}}).to_string())).unwrap();
    assert_eq!(v["snapshot"]["recommendations"], json!(["a"]));
    assert_eq!(v["snapshot"]["plans"][0]["eligibility"], "needs-validation");
}
#[test]
fn probe_requires_correct_vantage_and_explicit_origin_approval() {
    let v = validating();
    assert_eq!(v["snapshot"]["candidate"], "https://route.example");
    assert!(!v.to_string().contains("token=secret"));
    let bad = finish(&v, 0, true, json!({"status":200,"vantage":"local"}));
    assert_eq!(bad["snapshot"]["phase"], "validating");
    let valid = finish(&v, 0, true, json!({"status":200,"vantage":"public"}));
    assert_eq!(valid["snapshot"]["phase"], "candidate-ready");
    assert!(valid["snapshot"]["published"].is_null());
    let ready = run(
        Some(&valid["state"]),
        json!({"type":"approve-origin","origin":"https://route.example","generation":valid["state"]["generation"]}),
    );
    assert_eq!(ready["snapshot"]["published"], "https://route.example");
}
#[test]
fn mismatched_session_does_not_consume_effect() {
    let v = starting();
    let e = &v["effects"][0];
    let rejected = run(
        Some(&v["state"]),
        json!({"type":"effect-result","effectId":e["id"],"sessionId":"foreign","generation":e["generation"],"ok":true,"result":{}}),
    );
    assert_eq!(v["state"]["pending"], rejected["state"]["pending"]);
}
#[test]
fn stop_before_persist_ack_never_creates() {
    let v = run(None, json!({"type":"start","adapterId":"a","consent":true}));
    let e = &v["effects"][0];
    let stop = run(Some(&v["state"]), json!({"type":"stop"}));
    let late = run(
        Some(&stop["state"]),
        json!({"type":"effect-result","effectId":e["id"],"sessionId":e["sessionId"],"generation":e["generation"],"ok":true,"result":{"durable":true}}),
    );
    assert_eq!(late["effects"], json!([]));
    assert_eq!(late["snapshot"]["phase"], "stopped");
}
#[test]
fn reconcile_live_route_never_removes_active_resource() {
    let v = validating();
    let done = run(Some(&v["state"]), json!({"type":"reconcile"}));
    assert_eq!(done["effects"], json!([]));
    assert_eq!(done["state"], v["state"]);
}
#[test]
fn uncertain_create_remains_tracked_until_late_completion() {
    let v = starting();
    let timeout = finish(&v, 0, false, json!({"reason":"timeout"}));
    assert_eq!(timeout["state"]["pending"].as_object().unwrap().len(), 1);
    let stopped = run(Some(&timeout["state"]), json!({"type":"stop"}));
    assert_eq!(stopped["snapshot"]["phase"], "stopping");
    let e = &v["effects"][0];
    let late = run(
        Some(&stopped["state"]),
        json!({"type":"effect-result","effectId":e["id"],"sessionId":e["sessionId"],"generation":e["generation"],"ok":true,"result":{"stdout":"https://route.example","resourceId":"r-late"}}),
    );
    assert_eq!(late["snapshot"]["resources"][0]["cleanup"], "pending");
    assert_eq!(late["effects"][0]["operation"], "remove");
}
#[test]
fn failed_cleanup_persist_does_not_busy_retry() {
    let v = validating();
    let stop = run(Some(&v["state"]), json!({"type":"stop"}));
    let failed = finish(&stop, 0, false, json!({}));
    assert_eq!(failed["effects"], json!([]));
    let retry = run(Some(&failed["state"]), json!({"type":"reconcile"}));
    assert_eq!(retry["effects"][0]["kind"], "persist");
}
#[test]
fn lan_forwarder_reads_origin_from_typed_result() {
    let a = json!({"id":"forwarder","audience":"lan","ownership":"owned","capabilities":{"https":false},"recipes":{"create":{"kind":"local-forwarder","targetPort":9000,"parser":{"kind":"json","pointer":"/origin"}},"remove":{"kind":"local-forwarder"}}});
    let v:Value=serde_json::from_str(&gozar_core::step(&json!({"adapters":[a],"requirements":{"clientReach":"lan"},"command":{"type":"start","adapterId":"forwarder","consent":true}}).to_string())).unwrap();
    let create = finish(&v, 0, true, json!({"durable":true}));
    let probe = finish(
        &create,
        0,
        true,
        json!({"origin":"http://192.168.1.10:12345","resourceId":"forwarder-r1"}),
    );
    assert_eq!(probe["snapshot"]["candidate"], "http://192.168.1.10:12345");
    assert_eq!(probe["effects"][0]["vantage"], "lan");
}
#[test]
fn foreign_resource_cannot_be_removed_by_reconcile_or_stop() {
    let mut state = initial();
    state["resources"] = json!([{"id":"foreign-r1","adapterId":"a","generation":0,"ownership":"external-owned","cleanup":"pending"}]);
    let stop = run(Some(&state), json!({"type":"stop"}));
    let reconcile = run(Some(&stop["state"]), json!({"type":"reconcile"}));
    assert_eq!(stop["effects"], json!([]));
    assert_eq!(reconcile["effects"], json!([]));
}
#[test]
fn json_document_predicates_distinguish_login_and_traverse_arrays_and_escaped_keys() {
    let mut state = initial();
    state["adapters"][0]["recipes"]["detect"]["parser"] = json!({"kind":"json-document","predicate":{"op":"all","rules":[{"op":"equals","pointer":"/BackendState","value":"Running"},{"op":"exists","pointer":"/nodes/*/key~1name"},{"op":"not","rule":{"op":"exists","pointer":"/denied"}}]}});
    let v = run(Some(&state), json!({"type":"detect"}));
    let denied = finish(
        &v,
        0,
        true,
        json!({"stdout":"{\"BackendState\":\"NeedsLogin\",\"nodes\":[{\"key/name\":true}]}"}),
    );
    assert_eq!(denied["snapshot"]["observations"]["a"], "unknown");
    let good = finish(
        &v,
        0,
        true,
        json!({"stdout":"{\"BackendState\":\"Running\",\"nodes\":[{\"key/name\":true}]}"}),
    );
    assert_eq!(good["snapshot"]["observations"]["a"], "present");
    state["adapters"][0]["recipes"]["detect"]["parser"] =
        json!({"kind":"json-document","predicate":{"op":"not","rule":{"op":"unsupported"}}});
    let v = run(Some(&state), json!({"type":"detect"}));
    let bad = finish(&v, 0, true, json!({"stdout":"{}"}));
    assert_eq!(bad["snapshot"]["observations"]["a"], "unknown");
}
#[test]
fn bare_json_pointer_never_claims_logged_in() {
    let mut state = initial();
    state["adapters"][0]["recipes"]["detect"]["parser"] =
        json!({"kind":"json","pointer":"/BackendState"});
    let v = run(Some(&state), json!({"type":"detect"}));
    let done = finish(
        &v,
        0,
        true,
        json!({"stdout":"{\"BackendState\":\"NeedsLogin\"}"}),
    );
    assert_eq!(done["snapshot"]["observations"]["a"], "unknown");
}
#[test]
fn advanced_mutation_plan_fails_closed_before_executing_partial_recipe() {
    let mut state = initial();
    state["adapters"][0]["recipes"]["create"]["before"] =
        json!([{ "kind":"spawn","program":"verification" }]);
    let v = run(
        Some(&state),
        json!({"type":"start","adapterId":"a","consent":true}),
    );
    assert_eq!(v["effects"], json!([]));
    assert_eq!(v["snapshot"]["phase"], "failed");
}
#[test]
fn url_constraints_reject_banner_and_ambiguous_origins() {
    let mut state = initial();
    state["adapters"][0]["recipes"]["create"]["parser"] = json!({"kind":"url","prefix":"https://","constraints":{"hostnamePattern":"^[a-z0-9-]+\\.relay\\.example$","exactOriginToken":true,"rejectMultipleDistinct":true}});
    let v = run(
        Some(&state),
        json!({"type":"start","adapterId":"a","consent":true}),
    );
    let v = finish(&v, 0, true, json!({"durable":true}));
    let banner = finish(
        &v,
        0,
        true,
        json!({"stdout":"Docs https://docs.example Active https://one.relay.example","resourceId":"r1"}),
    );
    assert_eq!(banner["snapshot"]["candidate"], "https://one.relay.example");
    let multiple = finish(
        &v,
        0,
        true,
        json!({"stdout":"https://one.relay.example https://two.relay.example","resourceId":"r1"}),
    );
    assert!(multiple["snapshot"]["candidate"].is_null());
    let credentials = finish(
        &v,
        0,
        true,
        json!({"stdout":"https://secret@one.relay.example","resourceId":"r1"}),
    );
    assert!(credentials["snapshot"]["candidate"].is_null());
    assert!(!credentials.to_string().contains("secret@"));
}
#[test]
fn adapter_admission_and_binding_fields_block_start() {
    for field in ["bindings", "admission"] {
        let mut state = initial();
        state["adapters"][0][field] = json!({"requiredFeatures":["recipe-sequence"]});
        let v = run(
            Some(&state),
            json!({"type":"start","adapterId":"a","consent":true}),
        );
        assert_eq!(v["effects"], json!([]));
        assert_eq!(v["snapshot"]["phase"], "failed");
    }
}
#[test]
fn adapter_fixture_items_shape_matches_wildcard_foreground_map() {
    let mut state = initial();
    state["adapters"][0]["recipes"]["detect"]["parser"] = json!({"kind":"json-document","predicate":{"op":"all","items":[{"op":"equals","source":"stdout","pointer":"/BackendState","value":"Running"},{"op":"not","predicate":{"op":"exists","pointer":"/Foreground/*/TCP/8443"}}]}});
    let v = run(Some(&state), json!({"type":"detect"}));
    let occupied = finish(
        &v,
        0,
        true,
        json!({"stdout":"{\"BackendState\":\"Running\",\"Foreground\":{\"other\":{\"TCP\":{\"8443\":{}}}}}"}),
    );
    assert_eq!(occupied["snapshot"]["observations"]["a"], "unknown");
    let free = finish(
        &v,
        0,
        true,
        json!({"stdout":"{\"BackendState\":\"Running\",\"Foreground\":{}}"}),
    );
    assert_eq!(free["snapshot"]["observations"]["a"], "present");
}
#[test]
fn internet_reach_always_requires_https_even_when_flag_unspecified() {
    let v = starting();
    let bad = finish(
        &v,
        0,
        true,
        json!({"stdout":"http://insecure.example","resourceId":"r1"}),
    );
    assert_eq!(bad["snapshot"]["phase"], "failed");
    assert!(bad["snapshot"]["candidate"].is_null());
    assert_eq!(bad["effects"], json!([]));
}
#[test]
fn nonzero_removal_exit_never_erases_cleanup_debt() {
    let v = validating();
    let stop = run(Some(&v["state"]), json!({"type":"stop"}));
    let remove = finish(&stop, 0, true, json!({"durable":true}));
    let failed = finish(&remove, 0, true, json!({"exitCode":1}));
    assert_ne!(failed["snapshot"]["resources"][0]["cleanup"], "removed");
    assert_eq!(failed["snapshot"]["phase"], "cleanup-pending");
}
#[test]
fn active_recommend_and_detect_do_not_change_lifecycle() {
    let v = validating();
    for command in ["recommend", "detect"] {
        let done = run(Some(&v["state"]), json!({"type":command}));
        assert_eq!(done["state"], v["state"]);
        assert_eq!(done["effects"], json!([]));
    }
}
#[test]
fn required_transport_receipts_are_checked_before_candidate_ready() {
    let mut state = initial();
    state["requirements"]["sse"] = json!(true);
    state["requirements"]["streamableHttp"] = json!(true);
    let intent = run(
        Some(&state),
        json!({"type":"start","adapterId":"a","consent":true}),
    );
    let create = finish(&intent, 0, true, json!({"durable":true}));
    let probe = finish(
        &create,
        0,
        true,
        json!({"stdout":"https://route.example","resourceId":"r1"}),
    );
    let missing = finish(&probe, 0, true, json!({"status":200,"vantage":"public"}));
    assert_eq!(missing["snapshot"]["phase"], "validating");
    let passed = finish(
        &probe,
        0,
        true,
        json!({"status":200,"vantage":"public","streaming":true,"streamableHttp":true}),
    );
    assert_eq!(passed["snapshot"]["phase"], "candidate-ready");
}
