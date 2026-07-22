---
title: Syntax & types
layout: default
parent: Seebo formulas
nav_order: 1
---

# Syntax & types
{: .no_toc }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

Everything here goes **inside a formula slot** `${ … }`. (See the
[section overview](./index.md#the-three-kinds-of-slot) for comment and macro slots.)

## Literals

| Kind | Examples |
|------|----------|
| String | `'hello'` (single quotes) |
| Integer | `42` |
| Float | `3.14` |
| Boolean | `true`, `false` |
| Array | `[3, 1, 2]` |
| Object | `{ id: 1, name: 'Ada' }` |

## The type system

Every value is **typed**. The eight base types are:

`int` · `float` · `bool` · `string` · `datetime` · `duration` · `object` · `array`

Each type name is also a **constructor** you can call, both to *convert* a value and to *declare* a
type (for inputs). Because there is **no implicit coercion**, converting explicitly is common:

```text
${ string(1) + 'a' }        # '1a'  — string(...) converts the int first
${ int('5') + 1 }           # 6
```

Constructors also give you the type's methods:

```text
${ array([3, 1, 2]).min() }                       # 1
${ duration(50 * 3600).totalHours() }             # 50
${ datetime('2026-06-20').truncate('month').day() } # 1
```

### Constraints

A value can carry **constraints** via `.constraints({ … })`. Breaking one is a
`CONSTRAINT_VIOLATION`:

```text
${ int(5).constraints({ max: 3 }) }   # fails: 5 > 3
```

The `values` constraint is how a [choice input](../guide/document-templates.md#widget-catalog) offers
options:

```text
${ listbox({ id: 'plan', type: string(),
             values: ['Free', 'Pro'] }) }
```

## Operators

| Category | Operators | Notes |
|----------|-----------|-------|
| Arithmetic | `+` `-` `*` `/` | `/` by zero is `DIVISION_BY_ZERO`. |
| String | `+` | Concatenation (both sides must be strings — no coercion). |
| Comparison | `==` `!=` `<` `<=` `>` `>=` | |
| Logical | `and` `or` | Keyword operators. |
| Ternary | `cond ? a : b` | |
| Empty-coalescing | `a ?? b` | `b` when `a` is empty. |
| Temporal | `datetime + duration` | Date arithmetic. |
| Member / index | `x.field`, `x['field']` | Access object fields and capability results. |

{: .warning }
> **`??` treats only `''`, `[]` and `{}` as empty.** `0` and `false` are **not** empty:
> `${ 0 ?? 9 }` is `0`, but `${ '' ?? 'fallback' }` is `'fallback'`.

## `match`

`match` chooses a result by comparing a value against patterns; `*` is the default arm:

```text
${ 2 match { 1 => 'one', 2 => 'two', * => '?' } }   # 'two'
```

Omitting `*` when the value's type is open is a `NON_EXHAUSTIVE_MATCH` — add a `*` arm (a `bool`
match that covers both `true` and `false` is already exhaustive).

## Methods

Methods are **type-specific** — the ones available depend on the value's type:

```text
${ name.upper() }          # string → uppercase
${ now().year() }          # datetime → the year
${ [3,1,2].max() }         # array → 3
```

The formula editor offers **autocomplete** for the methods valid on the value you're working with,
so you don't have to memorize them. Calling a method that doesn't exist for that type is an
`UNKNOWN_METHOD`; the wrong number of arguments is an `ARITY_MISMATCH`.

## Producers: `now()` and `date()`

- **`now()`** returns the current `datetime`.
- **`date(pattern, text)`** parses text into a `datetime` using a token pattern
  (`YYYY MM DD HH mm ss Z`).

```text
Generated on ${ now().year() }
```

## Formatting & locale

A value is turned into text **only at the moment it is emitted**, using its format and the workspace
**locale**. The same number renders differently per locale:

```text
Total: ${ float(1234.5) }     # e.g. "1,234.5" (en) or "1.234,5" (it)
```

Numbers, dates, durations and currencies all follow the locale — you write the value, Seebo formats
it.
