import { Router, type IRouter } from "express";

const CLICKUP_BASE = "https://api.clickup.com/api/v2";
const FIELD_NAME = "DESPESAS OPERACIONAIS";

function getToken(): string {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) throw new Error("CLICKUP_API_TOKEN is not set");
  return token;
}

function getTeamId(): string {
  return process.env.CLICKUP_TEAM_ID ?? "3021706";
}

type CustomField = {
  id: string;
  name: string;
  value?: unknown;
};

type ClickUpTask = {
  id: string;
  name: string;
  custom_fields?: CustomField[];
};

type SearchResult =
  | { found: true; taskId: string; taskName: string; fieldId: string; currentDespesas: number }
  | { found: false; error: string; details?: unknown };

async function findTaskByCode(code: string, token: string): Promise<SearchResult> {
  const teamId = getTeamId();

  // Step 1: Search tasks by query
  const searchRes = await fetch(
    `${CLICKUP_BASE}/team/${teamId}/task?query=${encodeURIComponent(code)}&include_closed=true`,
    { headers: { Authorization: token, "Content-Type": "application/json" } },
  );

  if (!searchRes.ok) {
    const details = await searchRes.json().catch(() => ({}));
    return { found: false, error: "ClickUp task search request failed", details };
  }

  const searchData = (await searchRes.json()) as { tasks?: ClickUpTask[] };
  const tasks: ClickUpTask[] = searchData.tasks ?? [];

  // Step 2: Find task whose name contains the code
  const match = tasks.find((t) => t.name.includes(code));
  if (!match) {
    return { found: false, error: `No task found with name containing "${code}"` };
  }

  // Step 3: Fetch full task with custom fields
  const taskRes = await fetch(`${CLICKUP_BASE}/task/${match.id}?custom_fields=true`, {
    headers: { Authorization: token, "Content-Type": "application/json" },
  });

  if (!taskRes.ok) {
    const details = await taskRes.json().catch(() => ({}));
    return { found: false, error: "Failed to fetch task details", details };
  }

  const task = (await taskRes.json()) as ClickUpTask;

  // Step 4: Find the "DESPESAS OPERACIONAIS" custom field
  const field = (task.custom_fields ?? []).find(
    (f) => f.name.trim().toUpperCase() === FIELD_NAME,
  );

  if (!field) {
    return {
      found: false,
      error: `Custom field "${FIELD_NAME}" not found on task "${task.name}"`,
    };
  }

  const currentDespesas =
    typeof field.value === "number"
      ? field.value
      : parseFloat(String(field.value ?? "0")) || 0;

  return {
    found: true,
    taskId: task.id,
    taskName: task.name,
    fieldId: field.id,
    currentDespesas,
  };
}

const router: IRouter = Router();

router.get("/team-members", async (req, res): Promise<void> => {
  let token: string;
  try {
    token = getToken();
  } catch {
    res.status(500).json({ error: "CLICKUP_API_TOKEN is not configured" });
    return;
  }

  const teamId = getTeamId();
  const response = await fetch(`${CLICKUP_BASE}/team`, {
    headers: { Authorization: token, "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    req.log.warn({ status: response.status }, "Failed to fetch teams");
    res.status(response.status).json({ error: "Failed to fetch team members", details: err });
    return;
  }

  const data = (await response.json()) as {
    teams?: Array<{
      id: string;
      members?: Array<{ user?: { id: number; username?: string; email?: string } }>;
    }>;
  };

  const team = (data.teams ?? []).find((t) => t.id === teamId) ?? data.teams?.[0];
  const EXCLUDED_NAMES = ["Portal Cliente", "HD SCALA ACÚSTICA"];

  const members = (team?.members ?? [])
    .map((m) => ({ id: m.user?.id, name: m.user?.username ?? null }))
    .filter((m): m is { id: number; name: string } =>
      !!m.name && !EXCLUDED_NAMES.includes(m.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  res.json({ members });
});

// POST /api/search-task
// Body: { "code": "SLAB.510" }
router.post("/search-task", async (req, res): Promise<void> => {
  const { code } = req.body as { code?: string };
  if (!code) {
    res.status(400).json({ error: "Missing required field: code" });
    return;
  }

  let token: string;
  try {
    token = getToken();
  } catch {
    res.status(500).json({ error: "CLICKUP_API_TOKEN is not configured" });
    return;
  }

  const result = await findTaskByCode(code, token);

  if (!result.found) {
    req.log.warn({ code, error: result.error }, "Task search failed");
    res.status(404).json(result);
    return;
  }

  req.log.info({ code, taskId: result.taskId }, "Task found");
  res.json(result);
});

// POST /api/update-field
// Body: { "task_id": "...", "field_id": "...", "value": 10 }
router.post("/update-field", async (req, res): Promise<void> => {
  const { task_id, field_id, value } = req.body as {
    task_id?: string;
    field_id?: string;
    value?: number;
  };

  if (!task_id || !field_id || value == null) {
    res.status(400).json({ error: "Missing required fields: task_id, field_id, value" });
    return;
  }

  let token: string;
  try {
    token = getToken();
  } catch {
    res.status(500).json({ error: "CLICKUP_API_TOKEN is not configured" });
    return;
  }

  // Fetch current task to get existing field value
  const taskRes = await fetch(`${CLICKUP_BASE}/task/${task_id}?custom_fields=true`, {
    headers: { Authorization: token, "Content-Type": "application/json" },
  });

  if (!taskRes.ok) {
    const err = await taskRes.json().catch(() => ({}));
    req.log.warn({ task_id, status: taskRes.status }, "ClickUp get task failed");
    res.status(taskRes.status).json({ error: "Task not found", details: err });
    return;
  }

  const task = (await taskRes.json()) as ClickUpTask;
  const field = (task.custom_fields ?? []).find((f) => f.id === field_id);
  const currentValue =
    typeof field?.value === "number"
      ? field.value
      : parseFloat(String(field?.value ?? "0")) || 0;
  const newValue = currentValue + value;

  req.log.info({ task_id, field_id, currentValue, addValue: value, newValue }, "Updating field");

  const updateRes = await fetch(`${CLICKUP_BASE}/task/${task_id}/field/${field_id}`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ value: newValue }),
  });

  if (!updateRes.ok) {
    const err = await updateRes.json().catch(() => ({}));
    req.log.warn({ task_id, field_id, status: updateRes.status }, "ClickUp update field failed");
    res.status(updateRes.status).json({ error: "Failed to update field", details: err });
    return;
  }

  const result = await updateRes.json();
  res.json({ success: true, previousValue: currentValue, addedValue: value, newValue, result });
});

// POST /api/bulk-update-field
// Body: { "codes": ["SLAB.510", "SLAB.511"], "value": 10, "descricao": "optional text" }
router.post("/bulk-update-field", async (req, res): Promise<void> => {
  const { codes, value, descricao } = req.body as {
    codes?: unknown;
    value?: number;
    descricao?: string;
  };

  if (!Array.isArray(codes) || codes.length === 0) {
    res.status(400).json({ error: "Missing or empty required field: codes (array)" });
    return;
  }
  if (value == null) {
    res.status(400).json({ error: "Missing required field: value" });
    return;
  }

  const invalidCodes = codes.filter((c) => typeof c !== "string" || !c.trim());
  if (invalidCodes.length > 0) {
    res.status(400).json({ error: "All entries in codes must be non-empty strings" });
    return;
  }

  let token: string;
  try {
    token = getToken();
  } catch {
    res.status(500).json({ error: "CLICKUP_API_TOKEN is not configured" });
    return;
  }

  req.log.info({ codes, value, hasDescricao: !!descricao }, "Starting bulk field update");

  const results = await Promise.all(
    (codes as string[]).map(async (code) => {
      // Step 1: Find the task and its DESPESAS OPERACIONAIS field
      const found = await findTaskByCode(code, token);
      if (!found.found) {
        return { code, success: false, error: found.error, details: found.details };
      }

      const { taskId, taskName, fieldId, currentDespesas } = found;
      const newValue = currentDespesas + value;

      // Step 2: Update the custom field
      const updateRes = await fetch(`${CLICKUP_BASE}/task/${taskId}/field/${fieldId}`, {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ value: newValue }),
      });

      if (!updateRes.ok) {
        const details = await updateRes.json().catch(() => ({}));
        return { code, taskId, taskName, success: false, error: "Failed to update field", details };
      }

      // Step 3: If descricao provided, post it as a comment on the task
      let commentPosted = false;
      if (descricao && descricao.trim()) {
        const commentRes = await fetch(`${CLICKUP_BASE}/task/${taskId}/comment`, {
          method: "POST",
          headers: { Authorization: token, "Content-Type": "application/json" },
          body: JSON.stringify({ comment_text: descricao.trim(), notify_all: false }),
        });

        commentPosted = commentRes.ok;
        if (!commentRes.ok) {
          req.log.warn({ taskId, status: commentRes.status }, "Failed to post task comment");
        }
      }

      return {
        code,
        taskId,
        taskName,
        fieldId,
        success: true,
        previousValue: currentDespesas,
        addedValue: value,
        newValue,
        ...(descricao && descricao.trim() ? { commentPosted } : {}),
      };
    }),
  );

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  req.log.info({ succeeded, failed, total: results.length }, "Bulk update complete");
  res.json({ succeeded, failed, total: results.length, results });
});

export default router;
