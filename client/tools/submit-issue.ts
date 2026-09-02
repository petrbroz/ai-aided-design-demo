import type { ToolSpec } from "../webmcp.js";
import * as issues from "../issues.js";

export const submitIssueTool: ToolSpec = {
  name: "submit-issue",
  description:
    "Submit the draft currently on screen, exactly as it stands. Takes no arguments by " +
    "design: it can only submit what the user has been shown, so anything they asked " +
    "you to change has to go through draft-issue first, where they can see it. Only " +
    "call this once the user has approved the draft. Fails with the list of missing " +
    "fields if the draft is incomplete. On success the form clears and the issue " +
    "appears in the list with its id.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  run: async () => {
    const issue = await issues.submitDraft();
    return { submitted: issue, note: `Raised ${issue.id}. It is now in the issue list.` };
  },
};
