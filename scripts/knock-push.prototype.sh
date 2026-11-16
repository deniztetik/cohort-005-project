#!/usr/bin/env bash
# PROTOTYPE: pushes the Knock spike's workflows and default preferences to the
# Development environment via the Management API (issue 32). Idempotent.
# Run: bash scripts/knock-push.prototype.sh   (needs KNOCK_SERVICE_TOKEN in .env)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
API="https://control.knock.app/v1"
H=(-H "Authorization: Bearer $KNOCK_SERVICE_TOKEN" -H "Content-Type: application/json")
ENV="development"

push_workflow() {
  local key="$1" body="$2"
  echo "== workflow $key"
  curl -sS -X PUT "${H[@]}" "$API/workflows/$key?environment=$ENV&commit=true&commit_message=knock-spike" -d "$body" \
    | head -c 600
  echo
}

# Workflows may only use categories already in the project's catalog.
for cat in discussion new-enrollment; do
  echo "== category $cat"
  curl -sS -X PUT "${H[@]}" "$API/preference_categories/$cat" | head -c 300
  echo
done

push_workflow discussion-reply '{
  "workflow": {
    "name": "Discussion Reply",
    "categories": ["discussion"],
    "steps": [{
      "type": "channel", "ref": "in_app_feed_1", "channel_key": "in-app",
      "template": {
        "markdown_body": "**{{ actor.name }}** replied to your question in {{ data.lesson_title }}",
        "action_url": "{{ data.url }}"
      }
    }]
  }
}'

push_workflow new-enrollment '{
  "workflow": {
    "name": "New Enrollment",
    "categories": ["new-enrollment"],
    "steps": [{
      "type": "channel", "ref": "in_app_feed_1", "channel_key": "in-app",
      "template": {
        "markdown_body": "**{{ actor.name }}** enrolled in {{ data.course_title }}",
        "action_url": "{{ data.url }}"
      }
    }]
  }
}'

echo "== environment default preferences (current)"
curl -sS "${H[@]}" "$API/environments/$ENV/defaults" | head -c 600; echo
echo "== environment default preferences (set: new-enrollment off)"
curl -sS -X PUT "${H[@]}" "$API/environments/$ENV/defaults" -d '{
  "preference_set": { "categories": { "new-enrollment": false } }
}' | head -c 600
echo
