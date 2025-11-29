from django.contrib import admin
from tasks.models import Task,TaskDependency
# Register your models here.
class TaskAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "description",
        "completed",
        "estimated_hours",
        "priority",
        "due_date",
        "importance",
        "created_at",
        "updated_at",
        "urgency_score",
        "importance_score",
        "effort_score",
        "dependency_score",
    )

class DependencyTaskAdmin(admin.ModelAdmin):
    list_display = (
        "task",
        "dependency",
        "created_at",
        "updated_at",
        "is_circular",
    )


admin.site.register(Task,TaskAdmin)
admin.site.register(TaskDependency,DependencyTaskAdmin)

