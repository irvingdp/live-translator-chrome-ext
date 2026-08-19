# Shared UI Components

Framework: React 19 via WXT. Component library: none. Styling: custom vanilla CSS.

There is no shared UI component directory and no exported design-system primitive. The popup and options page intentionally keep their small form helpers local to their page modules, so there are no shared components whose full source belongs in this file.

The page-local helpers are:

- `src/popup/PopupApp.tsx`: `ProviderLink`, `RangeField`
- `src/options/OptionsApp.tsx`: `SecretField`

Their complete source is already contained in the corresponding page files and those files are selected directly as Superdesign context for their surfaces.
