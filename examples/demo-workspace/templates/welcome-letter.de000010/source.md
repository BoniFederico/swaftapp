---
swaftId: de000010-0000-4000-8000-000000000000
name: Welcome letter
type: document
subtype: markdown
tags: [demo]
---
# Welcome to ${ template('company').name }, ${ textbox({ id: 'name', label: 'Your name', type: string() }) }!

Thanks for choosing the **${ listbox({ id: 'plan', label: 'Plan', options: ['Free', 'Pro', 'Team'] }) }** plan.

${ template('company').name } helps you turn templates into documents, API calls and workflows.
Questions? Write to ${ template('company').support }.

_Generated in ${ now().year() }._
