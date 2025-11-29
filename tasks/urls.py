from django.urls import path
from tasks.views import (
    CompletedTasksView,
    DependencyTaskCreateView,
    TaskBulkCreateView,
    TaskList,
    TaskDetail,
    AnalyzeTasksView,
    TaskSuggestionView,
)

urlpatterns = [
    path('tasks/', TaskList.as_view(), name='task-list'),
    path('tasks/dependencies/', DependencyTaskCreateView.as_view(), name='dependency-task-create'),
    path('tasks/<int:pk>/', TaskDetail.as_view(), name='task-detail'),
    path('bulk_tasks/',TaskBulkCreateView.as_view(),name="bulk-create"),

    path('tasks/analyze/',AnalyzeTasksView.as_view()),
    path('tasks/suggest/',TaskSuggestionView.as_view()),
    path('tasks/completed/',CompletedTasksView.as_view())
]