from enum import unique
from typing import Required
from rest_framework import serializers

from tasks.helpers import update_priority
from .models import Task, TaskDependency
from rest_framework_recursive.fields import RecursiveField
class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ['id', 'title', 'description','importance', 'completed', 'estimated_hours', 'priority', 'due_date']
    def validate(self, attrs):
        return super().validate(attrs)
    def create(self, validated_data):
        validated_data['priority'] = 0 
        return super().create(validated_data)

class DependencyTaskCreateSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    dependencies_ids = serializers.ListField(child=serializers.IntegerField(), write_only=True)

    class Meta:
        model = Task
        fields = ['title', 'description', 'estimated_hours', 'priority', 'due_date', 'dependencies']

    def validate_dependencies_ids(self, value):
        if not len(value) == Task.objects.filter(id__in=value).count() and not all(Task.objects.filter(id=id).exists() for id in value):
            raise serializers.ValidationError("Invalid dependency IDs")
        return value

    def create(self, validated_data):
        dependencies_ids = validated_data.pop('dependencies_ids', [])
        task = Task.objects.get(id=validated_data['id'])
        
        for dependency_id in dependencies_ids:
            TaskDependency.objects.create(task=task, dependency_id=dependency_id)
        return task
from django.utils.text import slugify
from rest_framework import serializers


class AnalyzeTaskReadSerializer(serializers.ModelSerializer):
    dependencies = serializers.SerializerMethodField()
    dependents = serializers.SerializerMethodField()
    score = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            'id', 'title', 'importance', 'estimated_hours', 'due_date',
            'priority', 'dependencies', 'dependents',
            'urgency_score', 'effort_score', 'dependency_score', 'score'
        ]
        read_only_fields = fields

    def get_dependencies(self, obj):
        # Return list of titles (slugs)
        return list(obj.dependencies.values_list('title', flat=True))

    def get_dependents(self, obj):
        # Return list of titles (slugs) of tasks that depend on this one
        return list(obj.dependents.values_list('title', flat=True))

    def get_score(self, obj):
        from decimal import Decimal
        return (
            Decimal(obj.urgency_score or 0)
            + obj.importance
            + Decimal(obj.effort_score or 0)
            + Decimal(obj.dependency_score or 0)
        )



class AnalyzeTaskSerializer(serializers.ModelSerializer):
    dependencies = serializers.ListField(
        child=serializers.CharField(),
        required=False
    )

    dependents = RecursiveField(many=True, read_only=True)
    score = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            'id','title','importance','estimated_hours','due_date',
            'priority','dependencies','dependents',
            'urgency_score','effort_score','dependency_score','score'
        ]
        read_only_fields = [
            'priority','urgency_score','dependency_score','effort_score'
        ]

    # Slugify the title before storing
    def validate_title(self, value):
        return slugify(value)

    # For bulk creation, just return slugified dependency names
    def validate_dependencies(self, titles):
        return [slugify(t) for t in titles]

    # In bulk, the view handles dependencies assignment
    def create(self, validated_data):
        validated_data.pop('dependencies', None)
        return Task.objects.create(**validated_data)

    def get_score(self,obj):
        from decimal import Decimal
        return (
            Decimal(obj.urgency_score or 0)
            + obj.importance
            + Decimal(obj.effort_score or 0)
            + Decimal(obj.dependency_score or 0)
        )


