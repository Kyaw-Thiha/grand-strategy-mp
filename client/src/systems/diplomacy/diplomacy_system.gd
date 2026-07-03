extends Node
## Client diplomacy command facade.
## Reads no mutable game state and submits all diplomacy intents through CommandQueue.

signal action_submitted(action: String, target_nation_id: String)
signal vote_response_submitted(vote_id: String, accepted: bool)


## Submits a direct diplomacy action to the authoritative server.
## Parameters:
## - action: One of invite, declare_war, make_peace, quit_alliance, or kick.
## - target_nation_id: Nation affected by the action. Empty only for quit_alliance.
## Returns: nothing.
func submit_action(action: String, target_nation_id: String = "") -> void:
	var payload: Dictionary = {"action": action}
	if not target_nation_id.is_empty():
		payload["target_nation_id"] = target_nation_id
	CommandQueue.submit("DIPLOMACY_ACTION", payload)
	action_submitted.emit(action, target_nation_id)


## Submits a response to an active diplomacy vote.
## Parameters:
## - vote_id: Server-issued vote identifier from the interactive notification payload.
## - accepted: true for yes, false for no.
## Returns: nothing.
func submit_vote_response(vote_id: String, accepted: bool) -> void:
	if vote_id.is_empty():
		return
	CommandQueue.submit("DIPLOMACY_VOTE_RESPONSE", {
		"vote_id": vote_id,
		"accept": accepted,
	})
	vote_response_submitted.emit(vote_id, accepted)
