from decimal import Decimal, getcontext, ROUND_HALF_UP
from datetime import datetime
from django.db import transaction
from django.db.models import Max
from tasks.models import Task
from decimal import Decimal, getcontext, ROUND_DOWN

getcontext().prec = 28  # Higher precision if needed

def normalize_decimal(val):
    d = Decimal(val)
    # Quantize to 10 decimal places, no rounding up
    result = d.quantize(Decimal("1.0000000000"), rounding=ROUND_DOWN)
    print(f"normalize_decimal: input={val}, stored={result}")
    return str(result)

def compute_correspondent_scores():
    qs = Task.objects.filter(completed=False).order_by('created_at')
    total_count = qs.count()
    print(f"compute_correspondent_scores: total_count={total_count}")

    if total_count == 0:
        return []

    for i, task in enumerate(qs):
        task.priority = i
        print(f"Task {task.title} assigned temporary priority={i}")

    today = datetime.now().date()
    overdue_tasks = [t for t in qs if t.due_date <= today]
    upcoming_tasks = [t for t in qs if t.due_date > today]

    overdue_count = len(overdue_tasks)
    upcoming_count = len(upcoming_tasks)
    print(f"Overdue={overdue_count}, Upcoming={upcoming_count}")

    updated_tasks = []

    overdue_count = len(overdue_tasks)
    upcoming_count = len(upcoming_tasks)
    total_count = overdue_count + upcoming_count

    if total_count == 0:
        return updated_tasks

    if overdue_count == 0 or upcoming_count == 0:
        factor_overdue = factor_upcoming = Decimal('10')
    else:
        factor_overdue = Decimal('10') * (Decimal(max(overdue_count, upcoming_count)) / Decimal(total_count))
        factor_upcoming = Decimal('10') * (Decimal(min(overdue_count, upcoming_count)) / Decimal(total_count))

    print(f"factor_overdue={factor_overdue}, factor_upcoming={factor_upcoming}")

    for task in overdue_tasks:
        urgency = factor_overdue * (Decimal('1') - Decimal(task.priority) / Decimal(total_count))
        task.urgency_score = normalize_decimal(urgency)
        print(f"Task {task.title} urgency_score={task.urgency_score}")
        updated_tasks.append(task)

    for task in upcoming_tasks:
        urgency = factor_upcoming * (Decimal('1') - Decimal(task.priority) / Decimal(total_count))
        task.urgency_score = normalize_decimal(urgency)
        print(f"Task {task.title} urgency_score={task.urgency_score}")
        updated_tasks.append(task)

    return updated_tasks
@transaction.atomic
def compute_urgency_score():
    updated_tasks = compute_correspondent_scores()
    print("Bulk updating urgency_score for tasks:")
    for t in updated_tasks:
        print(f"{t.title}: {t.urgency_score}")
    Task.objects.bulk_update(updated_tasks, ['urgency_score'])
    return updated_tasks

# --- Effort Score ---
def compute_effort_score():
    qs = Task.objects.filter(completed=False).order_by('created_at')
    max_hours = qs.aggregate(max_hours=Max('estimated_hours'))['max_hours']
    print(f"compute_effort_score: max_hours={max_hours}")

    for task in qs:
        effort_score = Decimal('10') * (Decimal('1') - Decimal(task.estimated_hours) / Decimal(max_hours))
        normalized_score = normalize_decimal(effort_score)
        Task.objects.filter(id=task.id).update(effort_score=normalized_score)
        print(f"Task {task.title}: estimated_hours={task.estimated_hours}, effort_score={normalized_score}")

# --- Dependency Score ---
def compute_dependency_score():
    qs = Task.objects.filter(completed=False)
    total_tasks = qs.count() or 1
    print(f"compute_dependency_score: total_tasks={total_tasks}")

    for task in qs:
        dependency_count = task.dependencies.count()
        score = Decimal('10') * (Decimal('1') - Decimal(dependency_count) / Decimal(total_tasks))
        normalized_score = normalize_decimal(score)
        Task.objects.filter(id=task.id).update(dependency_score=normalized_score)
        print(f"Task {task.title}: dependency_count={dependency_count}, dependency_score={normalized_score}")

# --- Importance Score ---
def compute_importance_score():
    qs = Task.objects.filter(completed=False)
    max_importance = max(task.importance for task in qs) if qs.exists() else 1
    print(f"compute_importance_score: max_importance={max_importance}")

    for task in qs:
        score = Decimal(task.importance) / Decimal(max_importance) * Decimal('10')
        normalized_score = normalize_decimal(score)
        Task.objects.filter(id=task.id).update(importance_score=normalized_score)
        print(f"Task {task.title}: importance={task.importance}, importance_score={normalized_score}")

# --- Priority Update ---
def update_priority():
    qs = Task.objects.filter(completed=False).order_by('created_at')
    for i, task in enumerate(qs):
        Task.objects.filter(id=task.id).update(priority=i)
        print(f"Task {task.title}: priority set to {i}")

# --- Master function to update all scores ---
def create_scores():
    print("Updating all scores...")
    update_priority()
    compute_urgency_score()
    compute_effort_score()
    compute_dependency_score()
    compute_importance_score()
    print("All scores updated.")


from django.utils.text import slugify

def normalize_payload(data):
    normalized = []
    for item in data:
        new_item = item.copy()
        new_item["slug"] = slugify(item["title"])
        new_item["dependencies"] = [slugify(d) for d in item.get("dependencies", [])]
        normalized.append(new_item)
    return normalized



def extract_payload_titles(data):
    return {item["title"] for item in data if "title" in item}


def find_missing_from_payload(data, payload_titles):
    results = []

    for index, item in enumerate(data):
        deps = item.get("dependencies", [])
        missing = [d for d in deps if d not in payload_titles]
        results.append({"index": index, "missing": missing})

    return results



def find_missing_from_db(missing_results):
    final_errors = []

    for result in missing_results:
        missing_titles = result["missing"]
        if not missing_titles:
            continue

        # check DB existence
        actually_missing = []
        for title in missing_titles:
            if not Task.objects.filter(title=title).exists():
                actually_missing.append(title)

        if actually_missing:
            final_errors.append({
                "index": result["index"],
                "dependencies": {"missing_titles": actually_missing}
            })

    return final_errors
