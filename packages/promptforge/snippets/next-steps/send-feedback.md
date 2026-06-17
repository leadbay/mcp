## NEXT STEPS — after sending feedback

{{include:next-steps/ask-user-input-routing}}

| Observation                                  | Suggest                                              | Calls                                   |
|----------------------------------------------|------------------------------------------------------|-----------------------------------------|
| `sent == true`                               | "Anything else you'd like to flag to the team?"      | leadbay_send_feedback(message)          |
| `sent == false`                              | "It didn't go through — want to try sending again?"  | leadbay_send_feedback(message)          |
| Feedback was about an error the user hit      | "Want me to retry the action that failed?"           | (re-call the tool that errored)         |
