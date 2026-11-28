use gozar_core::{transition, Effect, Output};
use serde_json::{json, Value};

fn command(input: Value) -> Output {
    transition(&input.to_string()).expect("fixture command is valid")
}

fn initialized() -> Output {
    let adapter = |id: &str| {
        json!({
            "id": id, "audience": "public", "ownership": "owned",
            "capabilities": {"https": true, "sse": true, "streamableHttp": true, "oauthDcr": true},
            "recipes": {"detect": {"kind": "spawn", "program": "fixture-never-executed",
                "parser": {"kind": "contains", "stream": "stdout", "value": "fixture-present"}}}
        })
    };
    command(json!({
        "command": {"type": "detect", "sessionId": "fixture-session"},
        "adapters": [adapter("b"), adapter("a")]
    }))
}

fn effect(output: &Output, id: &str) -> Effect {
    output
        .effects
        .iter()
        .find(|effect| effect.operation == "detect" && effect.adapter_id == id)
        .expect("one declared detection per adapter")
        .clone()
}

fn refresh(output: Output) -> Output {
    command(json!({"state": output.state, "command": {"type": "detect"}}))
}

fn finish_detection(output: Output, effect: &Effect, stdout: &str) -> Output {
    let completed = command(json!({
        "state": output.state,
        "command": {"type": "effect-result", "effectId": effect.id, "sessionId": effect.session_id,
            "generation": effect.generation, "ok": true, "result": {"stdout": stdout}}
    }));
    assert!(completed.effects.is_empty());
    assert!(completed.state.resources.is_empty());
    assert!(completed.state.published.is_none());
    completed
}

#[test]
fn earlier_detection_cannot_erase_newer_provider_recommendation() {
    let initial = initialized();
    let a1 = effect(&initial, "a");
    let b1 = effect(&initial, "b");
    let recent = refresh(initial);
    let a2 = effect(&recent, "a");
    let b2 = effect(&recent, "b");
    assert_ne!(a1.id, a2.id);

    let view = finish_detection(recent, &a2, "fixture-present");
    assert_eq!(
        view.state.observations.get("a").map(String::as_str),
        Some("present")
    );
    let view = finish_detection(view, &b2, "nothing");
    let view = finish_detection(view, &b1, "fixture-present");
    let view = finish_detection(view, &a1, "nothing");
    let recommended = command(json!({"state": view.state, "command": {"type": "recommend"}}));
    assert_eq!(
        recommended.state.observations.get("a").map(String::as_str),
        Some("present")
    );
    assert_eq!(
        recommended.state.observations.get("b").map(String::as_str),
        Some("unknown")
    );
    assert_eq!(recommended.state.recommendations, vec!["a", "b"]);
}

#[test]
fn stale_result_arriving_first_cannot_publish_an_observation() {
    let initial = initialized();
    let a1 = effect(&initial, "a");
    let recent = refresh(initial);
    let a2 = effect(&recent, "a");
    let b2 = effect(&recent, "b");
    let view = finish_detection(recent, &a1, "fixture-present");
    assert!(!view.state.observations.contains_key("a"));
    let view = finish_detection(view, &a2, "nothing");
    let view = finish_detection(view, &b2, "fixture-present");
    assert_eq!(
        view.state.observations.get("a").map(String::as_str),
        Some("unknown")
    );
    assert_eq!(
        view.state.observations.get("b").map(String::as_str),
        Some("present")
    );
}
