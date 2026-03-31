# Design System Document

## 1. Overview & Creative North Star: "The Industrial Precisionist"

This design system is engineered to move beyond the generic "SaaS Dashboard" aesthetic. Our Creative North Star is **The Industrial Precisionist**. It draws inspiration from high-end aerospace interfaces and brushed-metal hardware, prioritizing clarity, high-density data visualization, and an unwavering sense of structural integrity.

To break the "template" look, we eschew traditional borders in favor of **Tonal Architecture**. By using varying shades of metallic gray and subtle light-refraction gradients, we create a UI that feels milled from a single block of platinum rather than assembled from digital parts. Precision is conveyed through generous white space, rigorous alignment, and a sophisticated monochromatic base punctuated by high-energy "Electric Blue" functional triggers.

---

## 2. Colors: Monochromatic Metallic Hierarchy

The palette is a study in gray-scale sophistication, using the "Silver," "Platinum," and "Zinc" themes to define spatial depth.

### Core Palette (Material Design Tokens)
*   **Background (`#f6fafe`):** A cool, crisp platinum base that prevents the UI from feeling "muddy."
*   **Primary (`#0040e0`):** The "Electric Blue." Used sparingly for high-intent actions and critical price data.
*   **Surface Tiers:**
    *   `surface_container_lowest`: `#ffffff` (The "Highlight" layer for top-level cards)
    *   `surface_container_low`: `#f0f4f8` (Standard secondary sectioning)
    *   `surface_container`: `#eaeef2` (The "Milled" base for layout containers)
    *   `surface_container_high`: `#e4e9ed` (Recessed areas or search bars)
*   **On-Surface (`#171c1f`):** Deep Zinc for high-contrast, professional legibility.

### The "No-Line" Rule
Standard 1px borders are strictly prohibited for sectioning. Structural boundaries must be achieved through **background color shifts**. For example, a `surface_container_lowest` card should sit atop a `surface_container` background to define its edge. If visual separation is insufficient, use a 1px "Ghost Border" using `outline_variant` at 15% opacity.

### The "Metallic Gradient" Rule
To inject "soul" into the industrial look, primary surfaces (like the Sidebar or Header) should utilize a subtle linear gradient (180deg) from `surface_bright` to `surface_container`. This mimics the way light hits a brushed metal surface.

---

## 3. Typography: Geometric Clarity

We utilize **Roboto** not as a default font, but as a geometric engine for precision.

| Level | Token | Weight | Size | Tracking | Use Case |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display** | `display-md` | 700 (Bold) | 2.75rem | -0.02em | Hero KPIs / Key Metrics |
| **Headline** | `headline-sm` | 500 (Medium) | 1.5rem | -0.01em | Section Headers |
| **Title** | `title-md` | 500 (Medium) | 1.125rem | 0 | Card Titles / Modal Headers |
| **Body** | `body-md` | 400 (Regular) | 0.875rem | +0.01em | Standard Data / Descriptions |
| **Label** | `label-md` | 700 (Bold) | 0.75rem | +0.05em | ALL-CAPS Table Headers / Tags |

**Editorial Note:** Use `label-md` in uppercase with increased letter-spacing for industrial "stenciled" metadata to reinforce the logistics/industrial theme.

---

## 4. Elevation & Depth: Tonal Layering

In this design system, depth is a product of light and material, not artificial shadows.

*   **The Layering Principle:** Treat the UI as a physical stack.
    1.  **Level 0 (Base):** `surface`
    2.  **Level 1 (Sections):** `surface_container_low`
    3.  **Level 2 (Active Cards):** `surface_container_lowest`
*   **Ambient Shadows:** Use shadows only for "floating" elements (Modals, Dropdowns). Use a multi-layered blur: `0px 4px 20px rgba(23, 28, 31, 0.06)`. The shadow color must be a tint of the `on_surface` (Zinc) to maintain a natural, atmospheric look.
*   **Glassmorphism:** For top navigation bars or floating action panels, use `surface_container_lowest` at 85% opacity with a `12px` backdrop-blur. This suggests a "frosted platinum" texture that keeps the user grounded in the dashboard's spatial context.

---

## 5. Components: Engineered Primitives

### Buttons (The High-Voltage Trigger)
*   **Primary:** Background: `primary` (#0040e0). Shape: `DEFAULT` (8px). Typography: `label-md` (white).
*   **Secondary:** Background: `surface_container_high`. Typography: `on_surface`. 
*   **Interaction:** On hover, primary buttons should utilize a subtle inner-glow (1px white overlay at 10%) to simulate a "lit" industrial switch.

### Cards & Data Lists
*   **No Dividers:** Forbid the use of horizontal lines between list items. Use a `1.5` (0.3rem) vertical gap and a subtle background change (`surface_container_low` vs `surface_container_lowest`) on hover to indicate row selection.
*   **The "Price Highlight":** Any financial or logistics cost data should be styled in `title-md`, utilizing the `primary` (Electric Blue) color to draw immediate attention.

### Input Fields
*   **Style:** Minimalist, "Chiseled" look. Background: `surface_container_low`. 
*   **Focus State:** No thick border. Instead, use a 2px `primary` bottom-border and a subtle `surface_container_lowest` background shift.

### Logistics-Specific Components
*   **Status Indicators:** Use "Industrial Pips"—small, solid circles (6px) with high-saturation status colors (Success, Error, Warning) placed next to `label-md` text.
*   **The "Route Path":** Use `outline_variant` dashed lines for transit paths, ensuring they look like technical drawings rather than decorative elements.

---

## 6. Do's and Don'ts

### Do
*   **DO** use intentional asymmetry. Align heavy data tables to the left and provide wide "breathing room" margins on the right for a premium, editorial feel.
*   **DO** use `surface_container_highest` for "well" areas—recessed containers that hold complex filter groups.
*   **DO** stick to the 8px (`DEFAULT`) corner radius religiously to maintain the "milled metal" consistency.

### Don't
*   **DON'T** use black (`#000000`) for text. Use the Zinc-toned `on_surface` to keep the palette sophisticated and unified.
*   **DON'T** use 100% opaque borders. They create "visual noise" that contradicts the minimalist, high-end goal.
*   **DON'T** use "Standard Blue" for links. Every interactive element must either be `primary` (Electric Blue) or a tonal variant of the Zinc/Silver palette.