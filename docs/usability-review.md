# Functionality and UI/UX review - v1.5

Reviewed 2026-09-20. Scope: local Windows PWA, everyday tracking, source setup, recovery, readability, keyboard access and mobile layouts. Existing provider scope/security limitations remain unchanged.

No dedicated UI/UX design skill was installed in this environment. The available Browser skill was inspected, but its execution tool was unavailable. Evaluation used source review, standalone Playwright Chromium, synthetic-data screenshots and W3C guidance; this is not a claim of a specialist skill invocation or a formal accessibility certification.

## Findings and implemented changes

| Priority | Finding | Change |
|---|---|---|
| High | Much of the interface used 8-11px labels and faint secondary text. | Increased type sizes and contrast for cards, forms, navigation, timestamps and controls. Added explicit light/dark tokens and representative contrast assertions. |
| High | Credential controls appeared after the source's main save buttons. | Connection setup now precedes a sticky source-action footer, with instructions distinguishing credential saving from source settings. The credential section has its own visible heading and background. |
| High | Pausing all sources showed first-run onboarding, suggesting saved data had disappeared. | A dedicated paused-workspace state explains that readings remain saved and links to source management. |
| High | A failed initial state request could be presented as an empty workspace. | Connection failure now shows recovery guidance and disables the primary Add source button until reconnection. |
| High | A PWA left open across server restarts or session expiration could fail until manually reconnected. | The client renews a rejected local session once and retries requests rejected with HTTP 401 before route execution. Session renewals are coalesced. Network-failed writes are never automatically replayed because their outcome can be uncertain. CSRF rejections remain enforced. |
| Medium | Refresh-all produced multiple racing notifications; active collection was not visible. | The backend state reports running source IDs. Cards show checking state and disable repeat refresh actions. Bulk refresh returns one summary distinguishing checking, cooldown, busy and failed requests. Busy sources are not described as queued. |
| Medium | Finding urgent tools required visually scanning every card. | Added sorting by name, next future reset, attention or existing order. The attention summary filters the cards; search also matches provider names and trims whitespace. View sorting does not change stored source order. |
| Medium | Dialog titles were not programmatically associated with their dialogs. | Added accessible dialog names/descriptions, heading focus on open, and retained focus restoration after close. |
| Medium | Mobile navigation could remain open behind keyboard interaction. | Added an overlay, visible close button, Escape handling, focus containment, inert background and expanded-state announcements. Resizing to desktop closes the drawer. |
| Medium | Several touch controls and narrow form fields were small. | Larger action targets, 16px mobile fields, a wrapping header, simplified mobile summary layout and single-column cards at narrower widths. Added a keyboard skip link and selected-state announcements for filters/navigation. |
| Medium | Authentication-paused cards described an error without a direct next step. | Added a Review connection action opening that source's settings. |

## Evaluation criteria

The visual changes follow the [W3C minimum contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), and [modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Representative small text is checked at 4.5:1 in light and dark themes. Primary mobile card/filter controls use 44px targets; desktop icon buttons use 36px targets. These checks are samples, not an exhaustive WCAG audit of every state.

Functional checks use both real isolated local API sessions and mocked provider-independent UI states. Coverage includes expired-session recovery, ambiguous mutation handling, source pause/enable, active collection, bulk summaries, sorting/filtering, keyboard focus, unavailable-server recovery and PWA behavior. No real usage data or keys are included in screenshots.

## Remaining improvement opportunities

- Confirm behavior with assistive technologies and real users; include high-contrast/forced-color modes, large text, touch devices and native installed-app windows.
- Unsaved changes can still be discarded by closing a form. A future change should protect edited source settings and manual observations without persisting password input.
- Sorting/filter selections currently apply to the open app session. Persisting non-sensitive view preferences would help frequent users.
- The reminder settings still require SMTP environment setup; a guided connection-status screen could make operator setup easier without exposing secrets.
- Windows DPAPI operations retain their existing ten-second deadline. Prior load-related timeout observations remain relevant; this UI release does not claim to eliminate them.
- Public hosting still requires a separate authentication, storage and worker design. Charts, portable import/export and live provider/SMTP validation are outside this review.

See [validation history](validation.md) for release results and [deployment readiness](deployment-readiness.md) for operating limits.
