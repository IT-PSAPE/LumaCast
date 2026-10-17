# ADR-0090: Defer LumaStream Virtual Camera

## Status

Accepted

## Date

2026-10-17

## Context

Windows virtual camera support requires a separately registered Media Foundation
source and a compatible install/registration path. The user chose to defer this
feature from the current Stream scope.

## Decision

- Do not ship a Virtual Camera control that cannot start a camera device.
- Keep virtual camera outside the current Stream feature scope until the user
  reopens the decision.

## Consequences

Stream continues to support its normal camera input source, but it does not
publish the composed program as a Windows camera device. The Controls dock only
shows functional output actions.
