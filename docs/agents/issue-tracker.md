# Wayfinding Operations: Local-Markdown Tracker

This repository uses a file-based local Markdown tracker to manage decisions, tasks, and fog of war during the development of cc-remote. All Wayfinder files reside in the `.wayfinder/` directory.

## Map Location

The canonical map is:
- Map File: [.wayfinder/map.md](file:///home/sergio/Developer/SideProjects/cc-remote/.wayfinder/map.md)
- Label representation: Marked with `# wayfinder:map` in its frontmatter.

## Ticket Location

Tickets are stored in:
- Tickets Directory: `.wayfinder/tickets/`
- Filename format: `[ID]_[title-slug].md` (e.g. `001_domain-modeling.md`)

## Ticket Schema

Each ticket must contain:

```markdown
---
id: "001"
title: "Ticket Title"
type: "research | prototype | grilling | task"
assignee: "antigravity"
status: "open | closed"
blocked_by: ["002", "003"]
---

## Question

<The core decision, design choice, or research question to resolve.>

## Answer

<The resolution, context pointers, and resulting facts. Filled in when the ticket is closed.>
```

## Operations

- **Creating the map**: Write the `map.md` with Notes, Decisions-so-far, and Fog.
- **Creating tickets**: Write files to `.wayfinder/tickets/`.
- **Claiming a ticket**: Set `assignee` in the frontmatter of the ticket file to your name.
- **Unblocked (Frontier) tickets**: Any ticket where all IDs in `blocked_by` refer to closed tickets.
- **Resolving a ticket**: Update its `status` to `closed`, write the `## Answer` section, append a context pointer to `map.md` under `Decisions so far`, and update the `Fog` section as needed.
