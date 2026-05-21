---
title: Task Log — {{ date }}
date: {{ date }}
tags: [task-log, daily]
---

# Task Log — {{ date }}

## Completed

{% for task in completed_tasks %}- [x] {{ task }}
{% else %}- 
{% endfor %}

## In Progress

{% for task in in_progress_tasks %}- [ ] {{ task }}
{% else %}- 
{% endfor %}

## Blocked / Waiting

{% for task in blocked_tasks %}- ⏸ {{ task }}
{% else %}*Nothing blocked.*
{% endfor %}

## Notes

{{ notes or "" }}

---
*{{ date }} · Jarvis-Pro*
