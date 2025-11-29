const API_ROOT ="http://localhost:8000"

const API = {
    analyze: `${API_ROOT}/api/tasks/analyze/`,
    suggest: `${API_ROOT}/api/tasks/suggest/`,
    taskDetail: (id) => `${API_ROOT}/api/tasks/${id}/`,
};

const SAMPLE_PAYLOAD = [
    {"title": "project-setup", "importance": 8, "estimated_hours": 10, "due_date": "2025-12-01", "dependencies": []},
    {"title": "env-config", "importance": 7, "estimated_hours": 5, "due_date": "2025-12-02", "dependencies": ["project-setup"]},
];

class EventBus {
    constructor() {
        this.events = {};
    }
    on(event, handler) {
        if (!this.events[event]) this.events[event] = [];
        this.events[event].push(handler);
    }
    emit(event, payload) {
        (this.events[event] || []).forEach((handler) => handler(payload));
    }
}

class ToastManager {
    constructor(root) {
        this.root = root;
    }
    push(message, timeout = 2600) {
        if (!this.root) return;
        const toast = document.createElement("div");
        toast.className = "toast";
        toast.textContent = message;
        this.root.appendChild(toast);
        setTimeout(() => {
            toast.classList.add("fade-out");
            toast.addEventListener("transitionend", () => toast.remove());
            toast.remove();
        }, timeout);
    }
}

class TaskStore {
    constructor(bus, toast) {
        this.bus = bus;
        this.toast = toast;
        this.tasks = [];
        this.sortedTasks = [];
        this.suggestions = [];
        this.strategy = "smart_balance";
        this.search = "";
        this.loading = false;
    }

    async init() {
        await Promise.all([this.fetchTasks(), this.fetchSuggestions()]);
    }

    setStrategy(strategy) {
        this.strategy = strategy;
        this.applyStrategy();
        this.fetchSuggestions();
    }

    setSearch(term) {
        this.search = term;
        this.fetchSuggestions();
    }

    async fetchTasks(showToast = false) {
        this.loading = true;
        try {
            const res = await fetch(API.analyze);
            if (!res.ok) throw new Error("Failed to load tasks");
            this.tasks = await res.json();
            this.applyStrategy();
            if (showToast) this.toast.push("Tasks refreshed");
        } catch (err) {
            console.error(err);
            this.toast.push(err.message || "Unable to fetch tasks");
        } finally {
            this.loading = false;
        }
    }

    applyStrategy() {
        this.sortedTasks = this.sortTasks([...this.tasks]);
        const payload = {
            active: this.sortedTasks.filter((task) => !task.completed),
            completed: this.sortedTasks.filter((task) => task.completed),
        };
        this.bus.emit("tasks:updated", payload);
    }

    sortTasks(list) {
        const byNumber = (val) => {
            if (val === null || val === undefined || val === "") return 0;
            const num = typeof val === "number" ? val : parseFloat(val);
            return Number.isNaN(num) ? 0 : num;
        };
        const getDateValue = (task) => {
            const date = task.due_date ? new Date(task.due_date) : null;
            return date ? date.getTime() : Number.MAX_SAFE_INTEGER;
        };
        const totalScore = (task) =>
            byNumber(task.urgency_score) + byNumber(task.effort_score) + byNumber(task.dependency_score) + byNumber(task.importance);

        switch (this.strategy) {
            case "fastest_wins":
                return list.sort((a, b) => byNumber(a.estimated_hours) - byNumber(b.estimated_hours));
            case "high_impact":
                return list.sort((a, b) => byNumber(b.importance) - byNumber(a.importance));
            case "deadline_driven":
                return list.sort((a, b) => getDateValue(a) - getDateValue(b));
            default:
                return list.sort((a, b) => totalScore(b) - totalScore(a));
        }
    }

    async fetchSuggestions() {
        const params = new URLSearchParams();
        if (this.strategy) params.set("prioritize", this.strategy);
        if (this.search) params.set("q", this.search);
        try {
            const res = await fetch(`${API.suggest}?${params.toString()}`);
            if (!res.ok) throw new Error("Failed to fetch suggestions");
            this.suggestions = await res.json();
            this.bus.emit("suggestions:updated", this.suggestions);
        } catch (err) {
            console.error(err);
            this.toast.push("Suggestion fetch failed");
        }
    }

    async submitBulk(raw) {
        try {
            const payload = JSON.parse(raw);
            const res = await fetch(API.analyze, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const detail = await res.json().catch(() => ({}));
                throw new Error(detail?.detail || "Bulk upload failed");
            }
            this.toast.push("Bulk upload sent");
            await this.fetchTasks();
            await this.fetchSuggestions();
        } catch (err) {
            console.error(err);
            this.toast.push(err.message || "Invalid JSON payload");
        }
    }

    async patchTask(id, patch) {
        const headers = { "Content-Type": "application/json" };
        const res = await fetch(API.taskDetail(id), {
            method: "PATCH",
            headers,
            body: JSON.stringify(patch),
        });
        if (!res.ok) {
            const detail = await res.json().catch(() => ({}));
            throw new Error(detail?.detail || "Update failed");
        }
        await this.fetchTasks();
        await this.fetchSuggestions();
        return res.json().catch(() => ({}));
    }

    async toggleComplete(task) {
        if (task.completed) {
            this.toast.push("Task already completed");
            return true;
        }
        await this.patchTask(task.id, { completed: true });
        this.toast.push("Task marked completed");
        return true;
    }

    async deleteTask(id) {
        try {
            const res = await fetch(API.taskDetail(id), { method: "DELETE" });
            if (!res.ok) {
                const detail = await res.json().catch(() => ({}));
                throw new Error(detail?.detail || "Delete failed");
            }
            this.toast.push("Task deleted");
            await this.fetchTasks();
            await this.fetchSuggestions();
        } catch (err) {
            console.error(err);
            this.toast.push(err.message || "Unable to delete task");
        }
    }

    async deleteAllTasks() {
        try {
            const res = await fetch(API.analyze, { method: "DELETE" });
            if (!res.ok) {
                const detail = await res.json().catch(() => ({}));
                throw new Error(detail?.detail || "Delete all failed");
            }
            this.tasks = [];
            this.sortedTasks = [];
            this.bus.emit("tasks:updated", { active: [], completed: [] });
            this.toast.push("All tasks have been deleted");
            await this.fetchSuggestions();
        } catch (err) {
            console.error(err);
            this.toast.push(err.message || "Unable to delete all tasks");
        }
    }
}

class StrategyBar {
    constructor(root, store) {
        this.root = root;
        this.store = store;
        this.searchBox = root.querySelector("#task-search");
        this.refreshBtn = root.querySelector("#refresh-tasks");
        this.badges = Array.from(root.querySelectorAll("[data-strategy]"));
        this.bindEvents();
        this.updateActiveBadge(this.store.strategy);
    }

    bindEvents() {
        let timer;
        this.searchBox.addEventListener("input", (e) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                this.store.setSearch(e.target.value.trim());
            }, 250);
        });

        this.refreshBtn.addEventListener("click", () => {
            this.store.fetchTasks(true);
            this.store.fetchSuggestions();
        });

        // Add event listener for Delete All button
        const deleteAllBtn = this.root.closest('.strategy-bar').querySelector('#delete-all-tasks');
        if (deleteAllBtn) {
            deleteAllBtn.addEventListener('click', async () => {
                if (confirm('Are you sure you want to delete all tasks? This action cannot be undone.')) {
                    deleteAllBtn.disabled = true;
                    try {
                        await this.store.deleteAllTasks();
                    } finally {
                        deleteAllBtn.disabled = false;
                    }
                }
            });
        }

        this.badges.forEach((badge) =>
            badge.addEventListener("click", () => {
                const strategy = badge.dataset.strategy;
                this.updateActiveBadge(strategy);
                this.store.setStrategy(strategy);
            })
        );
    }

    updateActiveBadge(strategy) {
        this.badges.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.strategy === strategy));
    }
}

class SuggestionsPanel {
    constructor(root) {
        this.root = root;
    }
    render(list) {
        this.root.innerHTML = "";
        if (!list?.length) {
            const p = document.createElement("p");
            p.className = "placeholder";
            p.textContent = "No suggestions right now.";
            this.root.appendChild(p);
            return;
        }
        list.forEach((task) => {
            const card = document.createElement("article");
            card.className = "suggestion";
            card.innerHTML = `
                <strong>${task.title}</strong>
                <p>Due: ${task.due_date || "—"}</p>
                <small>Importance ${task.importance} · Effort ${task.estimated_hours}h</small>
            `;
            this.root.appendChild(card);
        });
    }
}

class TaskCard {
    constructor(task, store, isCompletedTab = false) {
        this.task = task;
        this.store = store;
        this.isCompletedTab = isCompletedTab;
        this.element = this.createCard();
        if (this.isCompletedTab || this.task.completed) {
            this.element.classList.add('completed');
        }
    }

    createCard() {

        
        const card = document.createElement("article");
        card.className = "task-card";

        const json = document.createElement("pre");
        json.className = "card-json";
        json.textContent = JSON.stringify(this.task, null, 2);

        const toggleJson = () => {
            const next = !json.classList.contains("is-expanded");
            json.classList.toggle("is-expanded", next);
            card.classList.toggle("has-json-open", next);
        };

        const header = document.createElement("div");
        header.className = "card-header";

        const title = document.createElement("div");
        title.className = "card-title";
        title.textContent = this.task.title;
        header.appendChild(title);

        header.appendChild(this.buildActions(card, toggleJson));

        const body = document.createElement("div");
        body.className = "card-body";

        [
            ["Title", "title"],
            ["Description", "description"],
            ["Due Date", "due_date"],
            ["Estimated Hours", "estimated_hours"],
            ["Importance", "importance"],
            ["Priority", "priority"],
            ["Dependencies", "dependencies"],
            ["Urgency Score", "urgency_score"],
            ["Effort Score", "effort_score"],
            ["Dependency Score", "dependency_score"],
        ].forEach(([label, key]) => {
            body.appendChild(this.createFieldRow(label, key));
        });

        const mainColumn = document.createElement("div");
        mainColumn.className = "card-main";
        mainColumn.append(header, body);

        card.append(mainColumn, json);

        json.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleJson();
        });

        header.addEventListener("click", (event) => {
            if (event.target.closest(".card-actions")) return;
            card.classList.toggle("collapsed");
        });

        return card;
    }

   buildActions(card, toggleJson) {
    const container = document.createElement("div");
    container.className = "card-actions";

    // Add checkbox only for active tasks or if task is not completed
    if (!this.isCompletedTab || !this.task.completed) {
        const label = document.createElement("label");
        label.className = "task-checkbox";
        
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = this.task.completed;
        checkbox.disabled = this.isCompletedTab || this.task.completed;
        checkbox.title = this.task.completed ? "Completed" : "Mark as completed";
        
        if (!this.task.completed) {
            checkbox.addEventListener("change", async (event) => {
                event.stopPropagation();
                checkbox.disabled = true;
                try {
                    const next = await this.store.toggleComplete(this.task);
                    this.task.completed = next;
                    checkbox.checked = next;
                    checkbox.disabled = next;
                    checkbox.title = next ? "Completed" : "Mark as completed";
                } catch (error) {
                    console.error("Error toggling task completion:", error);
                    this.store.toast?.push("Failed to update task status");
                    checkbox.disabled = false;
                }
            });
        }
        
        const checkmark = document.createElement("span");
        checkmark.className = "checkmark";
        
        label.appendChild(checkbox);
        label.appendChild(checkmark);
        container.appendChild(label);
    }

    const jsonToggle = document.createElement("button");
    jsonToggle.className = "icon-button";
    jsonToggle.title = "Expand JSON";
    jsonToggle.textContent = "{ }";
    jsonToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleJson();
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "chip-button danger";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (!confirm("Delete this task?")) return;
        deleteButton.disabled = true;
        try {
            await this.store.deleteTask(this.task.id);
        } finally {
            deleteButton.disabled = false;
        }
    });

    // Only add the checkbox if it was created
    if (container.firstChild) {
        container.append(jsonToggle, deleteButton);
    } else {
        container.append(deleteButton);
    }
    
    return container;
}
    // updateTick method has been removed as it's no longer needed

    createFieldRow(label, key) {
        const row = document.createElement("div");
        row.className = "field-row";

        const labelEl = document.createElement("span");
        labelEl.className = "field-label";
        labelEl.textContent = label;

        const value = document.createElement("span");
        value.className = "field-value";
        value.dataset.key = key;
        value.textContent = this.formatValue(key, this.task[key]);

        const isEditable = key === "importance" && !this.isCompletedTab && !this.task.completed;
        if (isEditable) {
            value.dataset.editable = "true";
            value.title = "Click to edit";
            value.addEventListener("click", () => this.startInlineEdit(value, key));
        } else {
            value.classList.add("is-locked");
        }

        row.append(labelEl, value);
        return row;
    }

    formatValue(key, val) {
        if (Array.isArray(val)) return val.join(", ") || "—";
        if (val === null || val === undefined || val === "") return "—";
        return val;
    }

    startInlineEdit(element, key) {
        if (element.classList.contains("is-editing")) return;
        element.classList.add("is-editing");
        const initialValue = this.task[key] ?? "";
        const input = document.createElement("input");
        input.value = initialValue;
        input.className = "field-edit-input";
        input.addEventListener("keydown", async (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                await this.commitEdit(element, key, input.value);
            }
            if (event.key === "Escape") {
                element.classList.remove("is-editing");
                element.textContent = this.formatValue(key, initialValue);
            }
        });
        input.addEventListener("blur", () => {
            if (!input.dataset.saved) {
                element.classList.remove("is-editing");
                element.textContent = this.formatValue(key, initialValue);
            }
        });
        element.textContent = "";
        element.appendChild(input);
        input.focus();
    }

    async commitEdit(element, key, nextValue) {
        try {
            element.classList.add("is-saving");
            await this.store.patchTask(this.task.id, { [key]: nextValue });
            this.task[key] = nextValue;
            element.dataset.saved = "true";
            element.textContent = this.formatValue(key, nextValue);
        } catch (err) {
            console.error(err);
            this.store.toast?.push(err.message || "Update failed");
        } finally {
            element.classList.remove("is-editing", "is-saving");
            if (!element.dataset.saved) {
                element.textContent = this.formatValue(key, this.task[key]);
            }
        }
    }
}

class TaskBoard {
    constructor(root, store) {
        this.root = root;
        this.store = store;
        this.currentTab = "active";
        this.dataset = { active: [], completed: [] };
        this.tabs = document.querySelectorAll("[data-board-tab]");
        this.bindTabs();
        this.store.bus.on("tasks:updated", (payload) => {
            this.dataset.active = payload?.active || [];
            this.render();
        });
    }

    bindTabs() {
        this.tabs.forEach((tab) =>
            tab.addEventListener("click", () => {
                const target = tab.dataset.boardTab;
                if (target === this.currentTab) return;
                this.currentTab = target;
                this.updateTabs();
                this.render();
            })
        );
        this.updateTabs();
    }

    updateTabs() {
        this.tabs.forEach((tab) => {
            const isActive = tab.dataset.boardTab === this.currentTab;
            tab.classList.toggle("is-active", isActive);
            tab.setAttribute("aria-selected", String(isActive));
        });
    }

    async fetchCompletedTasks() {
        try {
            const res = await fetch(`${API_ROOT}/api/tasks/completed/`);
            if (!res.ok) throw new Error("Failed to load completed tasks");
            return await res.json();
        } catch (err) {
            console.error("Error fetching completed tasks:", err);
            this.store.toast?.push("Failed to load completed tasks");
            return [];
        }
    }

    async render() {
        let tasks = [];
        const isCompletedTab = this.currentTab === "completed";
        
        if (isCompletedTab) {
            tasks = await this.fetchCompletedTasks();
        } else {
            tasks = this.dataset.active || [];
        }
        
        this.root.innerHTML = "";

        if (!tasks.length) {
            const p = document.createElement("p");
            p.className = "placeholder";
            p.textContent =
                isCompletedTab
                    ? "Completed tasks will appear here."
                    : "Nothing to show yet.";
            this.root.appendChild(p);
            return;
        }

        tasks.forEach((task) => {
            const card = new TaskCard(task, this.store, isCompletedTab);
            this.root.appendChild(card.element);
        });
    }
}

class BulkModal {
    constructor(modal, sampleTarget) {
        this.modal = modal;
        this.sampleTarget = sampleTarget;
        this.sampleTarget.textContent = JSON.stringify(SAMPLE_PAYLOAD, null, 2);
        this.bind();
    }

    bind() {
        document.querySelectorAll("[data-modal-open]").forEach((btn) =>
            btn.addEventListener("click", () => this.open())
        );
        this.modal.querySelectorAll("[data-modal-close]").forEach((btn) =>
            btn.addEventListener("click", () => this.close())
        );
    }

    open() {
        this.modal.classList.remove("hidden");
    }

    close() {
        this.modal.classList.add("hidden");
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    const bus = new EventBus();
    const toast = new ToastManager(document.querySelector("[data-toast-stack]"));
    const store = new TaskStore(bus, toast);

    new StrategyBar(document.querySelector("[data-strategy-bar]"), store);
    const suggestions = new SuggestionsPanel(document.querySelector("[data-suggestions]"));
    bus.on("suggestions:updated", (list) => suggestions.render(list));
    new TaskBoard(document.querySelector("[data-task-board]"), store);
    new BulkModal(document.querySelector("[data-modal]"), document.querySelector("#sample-json"));

    document.querySelector("#bulk-upload").addEventListener("click", () => {
        const value = document.querySelector("#bulk-json").value.trim();
        if (!value) {
            toast.push("Paste some JSON first");
            return;
        }
        store.submitBulk(value);
    });

    document.querySelector("#analyze-trigger").addEventListener("click", () => {
        store.fetchTasks(true);
    });

    document.querySelector("#suggest-trigger").addEventListener("click", () => {
        store.fetchSuggestions();
    });

    await store.init();
});

