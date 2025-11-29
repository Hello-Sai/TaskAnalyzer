from copy import deepcopy
from datetime import datetime
from django.db import models

# Create your models here.


class Task(models.Model):
    title = models.CharField(max_length=200,unique=True)
    description = models.TextField(blank=True)
    completed = models.BooleanField(default=False)
    estimated_hours= models.IntegerField()

    priority = models.IntegerField(null=True)
    due_date = models.DateField()
    importance = models.IntegerField()
    dependencies = models.ManyToManyField('self',through='TaskDependency', symmetrical=False, related_name="dependents")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


    urgency_score = models.CharField(max_length=10,null=True)
    importance_score = models.CharField(max_length=10,null=True)
    effort_score = models.CharField(max_length=10,null=True)
    dependency_score = models.CharField(max_length=10,null=True)
    def __str__(self):
        return self.title

    
    
    
    def score(self):
        return self.dependency_score + self.effort_score +  self.urgency_score + self.importance_score    
    @classmethod
    def count_tasks(cls):
        return cls.objects.count()
class TaskDependency(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='dependency_tasks')
    dependency = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='dependent_tasks')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_circular = models.BooleanField(default=False)
    def __str__(self):
        return f"{self.task.title} depends on {self.dependency.title}"