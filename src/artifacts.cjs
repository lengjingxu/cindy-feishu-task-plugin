"use strict";
const { fail } = require("./core.cjs");
function validateArtifacts(items) {
  if (!Array.isArray(items) || items.length > 5) fail("ARTIFACT_MANIFEST_REQUIRED");
  const ids = new Set();
  return items.map(a => {
    if (!a || !/^[a-zA-Z0-9_-]{1,64}$/.test(a.id || "") || ids.has(a.id) ||
        typeof a.name !== "string" || !a.name || a.name.length > 200 || /[\\/\x00-\x1f]/.test(a.name) ||
        !Number.isSafeInteger(a.bytes) || a.bytes < 1 || a.bytes > 50 * 1024 * 1024) fail("ARTIFACT_INVALID");
    ids.add(a.id); return { id: a.id, name: a.name, bytes: a.bytes };
  });
}
function grantFor(artifact, grant) {
  if (!grant?.token || grant.file_count !== 1 || grant.total_bytes !== artifact.bytes ||
      !Array.isArray(grant.rel_paths) || grant.rel_paths.length !== 1 || grant.rel_paths[0] !== artifact.name) fail("FILE_GRANT_MISMATCH");
  return { token: grant.token, fileField: "file" };
}
function fileMatches(snapshot, operation) {
  const receipt = operation.receipt;
  return Boolean(receipt?.guid && snapshot.attachments?.some(a => a.guid === receipt.guid && a.name === operation.value.name &&
    a.size === operation.value.bytes && a.resource?.id === operation.taskGuid && a.resource?.type === "task_delivery"));
}
class GrantedUpload {
  constructor(fetch, authenticated) { this.fetch = fetch; this.authenticated = authenticated; }
  prepare(artifact, grant) {
    grantFor(artifact, grant);
    // No token in Node may be returned to main or injected via an ignored Authorization header.
    if (!this.authenticated()) fail("HOST_UPLOAD_AUTH_UNAVAILABLE");
  }
  async send(taskGuid, artifact, grant, callId) {
    this.prepare(artifact, grant);
    const response = await this.fetch({ url: "https://open.feishu.cn/open-apis/task/v2/attachments/upload", method: "POST",
      uploadDir: { ...grantFor(artifact, grant), fields: { resource_type: "task_delivery", resource_id: taskGuid } }, callId });
    if (!response.ok || response.status < 200 || response.status >= 300 || response.truncated) fail("FILE_UPLOAD_UNCERTAIN");
    let body; try { body = JSON.parse(response.body); } catch { fail("FILE_UPLOAD_UNCERTAIN"); }
    if (body.code !== 0 || body.data?.items?.length !== 1) fail("FILE_UPLOAD_UNCERTAIN");
    const a = body.data.items[0];
    if (!a.guid || a.name !== artifact.name || a.size !== artifact.bytes || a.resource?.id !== taskGuid || a.resource?.type !== "task_delivery") fail("FILE_UPLOAD_UNCERTAIN");
    return { guid: a.guid, name: a.name, size: a.size, resource: a.resource };
  }
}
function verifiedArtifact(task, artifactId) {
  const artifact = task.result?.artifacts?.find(a => a.id === artifactId);
  if (!artifact) fail("ARTIFACT_NOT_FOUND");
  const op = task.outbox?.find(o => o.kind === "file" && o.value.id === artifactId && o.state === "verified");
  if (!op || !fileMatches({ attachments: [op.receipt] }, { ...op, value: artifact, taskGuid: task.id })) fail("ARTIFACT_NOT_READY");
  return { ...artifact, guid: op.receipt.guid };
}
function attachmentLink(attachment, expected, taskGuid) {
  if (!attachment || attachment.guid !== expected.guid || attachment.name !== expected.name ||
      attachment.size !== expected.bytes || attachment.resource?.id !== taskGuid || attachment.resource?.type !== "task_delivery") fail("ARTIFACT_SCOPE_MISMATCH");
  let url;
  try { url = new URL(attachment.url); } catch { fail("ARTIFACT_LINK_UNAVAILABLE"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) fail("ARTIFACT_LINK_UNAVAILABLE");
  // Short-lived URL from the authenticated Feishu API; never persist it or return file_token.
  return { url: url.href, name: expected.name };
}
module.exports = { validateArtifacts, grantFor, fileMatches, GrantedUpload, verifiedArtifact, attachmentLink };
