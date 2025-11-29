# Smart Task Analyzer

Before would like to continue I didn't insisted my project with only django for frontend and backend.
To maintain Modularity and Understandability.
I have Just used plain VanillaJs on different Port (3000)

## Backend (Django)

1. Create a virtual environment :
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   ```
2. Install dependencies from `requirements.txt` 

```bash
pip install -r requirements.txt
```
3. start the server:
   ```bash
   
   python manage.py runserver
   ```
4.  Endpoints :
   - `POST /api/tasks/analyze/` – bulk ingest + scoring.
   - `GET /api/tasks/analyze/` – retrieve scored tasks.
   - `GET /api/tasks/suggest/?prioritize=fastest_wins|high_impact|deadline_driven` 
   
## Core Logic (Scoring Formula )

The system calculates four scores for every active task: **Urgency**, **Effort**, **Dependency**, and **Importance**. Importance is given by the user(Editable at later). 


* **Scale:** All scores are normalized to **0–10** so they are easy to align and compare.

---
### Urgency Score

* Arrange active tasks by `created_at` (or any stable order) and assign a temporary `priority` index from `0` to `N-1`.
* Make a ratio from `0` to `1` using `priority / (N-1)`, then reverse it with `1 - ratio` so earlier tasks score higher.
* Give overdue tasks an extra boost by using a larger `factor` for them; use a smaller factor for future tasks.

**Formula**

```
# N = total active tasks
ratio = Decimal(priority) / Decimal(max(N - 1, 1))
reversed = Decimal(1) - ratio
# factor is in range [0..10]; overdue tasks use factor_overdue, others use factor_upcoming
urgency = factor * reversed
urgency_scaled = clamp(urgency, 0, 10)
```

---

### Effort Score

* Find `max_hours` among active tasks.
* Tasks with fewer estimated hours should score higher (easier to finish).

**Formula:**

```
# Guard against division by zero
effort_ratio = Decimal(task.estimated_hours) / Decimal(max(max_hours, 1))
effort = (Decimal(1) - effort_ratio) * Decimal(10)
effort_scaled = clamp(effort, 0, 10)
```

---

### Dependency Score

* Count how many dependencies a task has.
* More dependencies -> lower score (should be scheduled later). Normalize by total active tasks.

**Formula:**

```
dep_ratio = Decimal(task.dependencies.count()) / Decimal(max(N, 1))
dependency_score = (Decimal(1) - dep_ratio) * Decimal(10)
dependency_scaled = clamp(dependency_score, 0, 10)
```

---

### Importance Score

* The user gives an `importance` value. Normalize by the maximum importance in the dataset and scale to 0–10.

**Formula:**

```
importance_score = (Decimal(task.importance) / Decimal(max_importance)) * Decimal(10)
importance_scaled = clamp(importance_score, 0, 10)
```

---

### Helpers & Notes
* Taken a Precision of 28 for higher deviation.
* Used a function (`normalize_decimal`) to quantize values (for example: 10 decimal places) and avoid floating-point drift.
* Always clamp results to `[0, 10]` to avoid unexpected values.
* Typical update order in code:

  1. set priorities (stable ordering)
  2. compute urgency (overdue factor handled here)
  3. compute effort
  4. compute dependency
  5. compute importance

---

- **Analyze & Suggest:** Use the top toolbar buttons to fetch scores (`GET /api/tasks/analyze/`) and refresh recommendations (`GET /api/tasks/suggest/`).
- **Inline Edits:** You can Modify the Importance at the same Inline field by clicking on it and after editing Enter to save.
- **JSON Toggle:** Each card includes a `{}` control that slides a side-by-side JSON view for quick copy/paste or debugging.
- **Completion Tick:** The circular tick is grey by default, turns black on hover, and locks solid black (disabled) after marking completed; completed tasks move to the “Completed Tasks” tab and can also be fetched via `GET /api/tasks/completed/`.
- **Bulk Upload:** Paste a JSON array into the toolbar textarea and click “Send Bulk” to hit `POST /api/tasks/analyze/`. A modal (triggered from the bottom-left floating icon or toolbar info button) displays a sample payload.