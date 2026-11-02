// Server-only: start a GitHub Actions workflow on main. On-demand runs start within
// about a minute, unlike GitHub's own cron, which has run CALIBEX jobs 4–6h late.
// GITHUB_DISPATCH_TOKEN: fine-grained PAT on the repo below, Actions read & write.
// GITHUB_REPO: "owner/name" of the repo that holds the workflows.
export async function dispatchWorkflow(file: string, inputs: Record<string, string>): Promise<{ ok: boolean; status: number; detail: string }> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return { ok: false, status: 503, detail: "GITHUB_DISPATCH_TOKEN unset" };
  const repo = process.env.GITHUB_REPO;
  if (!repo) return { ok: false, status: 503, detail: "GITHUB_REPO unset" };
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${file}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main", inputs }),
  });
  return { ok: r.ok, status: r.status, detail: r.ok ? "" : await r.text() };
}
