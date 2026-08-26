# AT4DX binding validation fixtures

A minimal Salesforce DX source tree used to exercise **AT4DX: Show Domain Process Bindings**'
validation (see `docs/design/0007-at4dx-validate-viewed-bindings.md`) against every rule
`validateDomainProcessBindings` checks, plus the collision detection `resolveDomainProcessBindings`
already had. Point the extension's "Choose Source Folder…" picker at `testfixtures/`, or open it
directly as a workspace folder — `sfdx-project.json` names both package directories.

| File | `pkg` | Exercises |
| --- | --- | --- |
| `Account_Criteria_BeforeInsert` | 1 | Clean binding — no issues. |
| `Account_Action_BeforeInsert` | 1 | Clean binding sharing order 10 with the Criteria above — not a collision (different `Type__c`). |
| `Account_Action_Collision_A` / `_B` | 1 | `order-collision` — two active `Action` bindings tied on `OrderOfExecution__c` 20. |
| `Account_Missing_TriggerOperation` | 1 | `missing-context-field` — `ProcessContext__c` is `TriggerExecution` but `TriggerOperation__c` is never set; can never match a trigger event. |
| `Account_Ambiguous_SObject` | 1 | `ambiguous-sobject-reference` — both SObject fields set, to `Account` and `Contact`. Resolves under Account. |
| `No_SObject_Reference` | 1 | `missing-sobject-reference` — neither SObject field set. Excluded from rows entirely; only ever visible as an issue. |
| `Dup_Binding` (pkg1, Account) / `Dup_Binding` (pkg2, Contact) | 1 & 2 | `duplicate-developer-name` — same `DeveloperName`, same derived `source` (both package directories use `main/default`, so the source label is `default` for each), different SObjects. |
| `Opportunity_Criteria_AfterUpdate` | 1 | Clean binding, and the only one under Opportunity — selecting Opportunity shows "no problems in this SObject" while every other issue above still lists under "elsewhere in this scan". |

Every clean binding is `IsActive__c = true`; nothing here relies on inactive records.
