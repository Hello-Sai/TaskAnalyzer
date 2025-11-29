from datetime import date
from decimal import Decimal
from django.db import transaction
from django.db.models import F, ExpressionWrapper
from django.db.models.functions import Cast
from django.shortcuts import render
from rest_framework import generics, status
from rest_framework.fields import DecimalField
from rest_framework.response import Response
from rest_framework.views import APIView
from operator import attrgetter

from tasks.helpers import create_scores, extract_payload_titles, find_missing_from_db, find_missing_from_payload
from .models import Task, TaskDependency
from .serializers import AnalyzeTaskReadSerializer, DependencyTaskCreateSerializer, TaskSerializer, AnalyzeTaskSerializer
from django.shortcuts import render

class HomeView:
    def get(self,request):
        return render(request,"index.html")

class TaskList(generics.ListCreateAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer


class CompletedTaskList(generics.ListAPIView):
    queryset = Task.objects.filter(completed=True).order_by('updated_at')
    serializer_class = TaskSerializer

class TaskDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer

    def perform_update(self, serializer):
        print(serializer.validated_data)
        serializer.save()
        if serializer.validated_data.get('completed')== True:
            create_scores()
        return Response({"message":"successfully Changed"})

class DependencyTaskCreateView(generics.CreateAPIView):
    queryset = Task.objects.all()
    serializer_class = DependencyTaskCreateSerializer



class TaskBulkCreateView(APIView):
    def post(self, request, *args, **kwargs):
        # request.data is expected to be a list of task dicts
        serializer = TaskSerializer(data=request.data, many=True)
        if serializer.is_valid():
            serializer.save()  
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors,status = status.HTTP_400_BAD_REQUEST)

   
    
    def delete(self,request):
        self.get_queryset().delete()
        return Response("all deleted")

class TaskSuggestionView(APIView):
    def get_queryset(self):
        return Task.objects.filter(completed = False).order_by('created_at')
    def filter(self):
        filters = self.request.query_params
        qs = list(self.get_queryset())  # fetch queryset

        for obj in qs:
            obj.urgency_score = Decimal(obj.urgency_score)
            obj.effort_score = Decimal(obj.effort_score)
            obj.dependency_score = Decimal(obj.dependency_score)
            obj.importance_score = Decimal(obj.importance)
            
            obj.total_score = obj.urgency_score + obj.effort_score + obj.dependency_score

        # Applying filters on User's Priority
        if filters.get('prioritize') == "fastest_wins":
            # Only effort score matters
            sorted_qs = sorted(qs, key=attrgetter('effort_score'),reverse=True)

        elif filters.get("prioritize") == "high_impact":
            # Prioritize importance
            sorted_qs = sorted(qs, key=attrgetter('importance_score'), reverse=True)

        elif filters.get("prioritize") == "deadline_driven":
            # Prioritize due date: earliest due date wins
            today = date.today()
            sorted_qs = sorted(
                qs, 
                key=lambda x: x.due_date 
            )

        else:
            sorted_qs = sorted(qs, key=attrgetter('total_score'), reverse=True)

   
        top3 = sorted_qs[:3]
        return top3
    def get(self,request):
        serializer = AnalyzeTaskReadSerializer(self.filter(),many=True)
        return Response(serializer.data)


class AnalyzeTasksView(generics.GenericAPIView):
    queryset = Task.objects.all()
    serializer_class = AnalyzeTaskSerializer

    def get(self, request):
        serializer = AnalyzeTaskReadSerializer(self.get_queryset().filter(completed=False), many=True)
        return Response(serializer.data)
    @transaction.atomic
    def post(self, request):
        serializer = self.serializer_class(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)

        validated_list = serializer.validated_data

        created_map = {}
        dependency_map = {}

        for data in validated_list:
            deps = data.pop('dependencies', [])
            slug = data['title']

            task, _ = Task.objects.get_or_create(
                title=slug,
                defaults=data
            )
            created_map[slug] = task
            dependency_map[slug] = deps

        missing_errors = []
        for slug, deps in dependency_map.items():
            dep_instances = Task.objects.filter(title__in=deps)
            missing = set(deps) - set(dep_instances.values_list('title', flat=True))
            if missing:
                missing_errors.append({"task": slug, "missing_dependencies": list(missing)})
            created_map[slug].dependencies.set(dep_instances)

        if missing_errors:
            return Response(missing_errors, status=400)

        create_scores()
        return Response({"status": "success"}, status=201)

    def delete(self, request):
        self.get_queryset().delete()
        return Response({"status": "all deleted"})


class CompletedTasksView(generics.ListAPIView):
    serializer_class = AnalyzeTaskReadSerializer

    def get_queryset(self):
        return (
            Task.objects.filter(completed=True)
            .order_by('-updated_at')
        )