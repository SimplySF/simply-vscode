# AT4DX binding validation fixtures

A minimal Salesforce DX source tree used to exercise **AT4DX: Open Explorer**'
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

## Application Factory fixtures

Added for the Application Factory explorer (docs/design/0016). All under `pkg1`.

| File | Exercises |
| --- | --- |
| `ApplicationFactory_ServiceBinding.PricingService_Impl_A` / `_B` | Priority tie — both bind `IPricingService` at priority 10. Renders as the amber "Resolves today" / "May win instead" pair. |
| `ApplicationFactory_SelectorBinding.Accounts_Selector_Primary` / `_Legacy` | Distinct priorities (20 vs. 10) on the same `Account` key — a clean Effective/Shadowed pair, no tie. |
| `ApplicationFactory_SelectorBinding.Tasks_Selector` | `BindingSObject__c = Task` — `unsupported-entity-definition-object`, since `Task` isn't in `ENTITY_DEFINITION_STANDARD_OBJECTS`. |
| `ApplicationFactory_DomainBinding.Contacts_Domain_A` / `_B` | Two Domain bindings sharing the `Contact` key — `duplicate-domain-sobject`, and both render `Ambiguous` (Domain has no priority to break the tie). |
| `ApplicationFactory_UnitOfWorkBinding.Account_UnitOfWork` (seq 10), `Contact_UnitOfWork` (seq 20), `Opportunity_UnitOfWork` (seq 20), `Case_UnitOfWork` (no sequence) | Commit order `1st`, `2nd or 3rd` ×2, and one unordered row — plus `sequence-collision` for the tied pair. |
