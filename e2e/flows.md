# Jarvis User Flow Tree

This is the living coverage map for E2E tests. Update it whenever a new tab, feature, or surface is added.
★ = critical flow (smoke suite, runs on every commit)

## JARVIS (localhost:3001)

```
★ App loads without crash
★ Auth token present → UI unlocked (no auth prompt)

├── JARVIS HQ TAB [aria-label*="Jarvis HQ"]
│   ★ Conversation panel visible
│   ★ Chat input present and accepts text
│   - Send message → streaming response appears
│   - Agent status updates during processing
│   - New session clears history
│
├── AGENT ARSENAL TAB [aria-label*="Agent Arsenal"]
│   - Agent list renders
│   - Agent status badges reflect live state
│   - Click agent → details or panel opens
│
├── CONTENT ANALYZER TAB [aria-label*="Content Analyzer"]
│   ★ Sidebar (aside) renders at least one item
│   ★ Email-sourced items show amber ✉ badge
│   - Click URL analysis → research + citations visible
│   - Click image analysis → breakdown/results visible
│   - Chat on analysis → response references content (not generic)
│   - Email subject shown below filename for email items
│
├── SETTINGS TAB [aria-label*="Settings"]
│   └── INTEGRATIONS section
│       ★ "niggims@agentmail.to" visible
│       - Email inbox enable/disable toggle interactive
│       - Processed email count visible
│       - Last received time updates
│       - Error list shows when errors present
│   └── AUDIO section
│       - Sound picker renders options
│       - Preview button plays sound
│   └── SURFACES section
│       - X Monitor toggle visible and interactive
│       - Runtime status strip toggle visible
│
├── TERMINAL TAB [aria-label*="Terminal"]
│   - Terminal renders and accepts keystrokes
│
├── MONITOR TAB [aria-label*="Surveillance"]
│   - Panel renders (or shows disabled state gracefully)
│
└── GENERATOR TAB [aria-label*="Generator"]
    - Generator UI renders
    - No broken image placeholders in gallery
```

## Surfaces Not Yet Tested (future)

- Mobile: niggims@agentmail.to → send email → analysis appears (requires AgentMail + live email)
- iOS companion app (if built): Xcode MCP test surface
