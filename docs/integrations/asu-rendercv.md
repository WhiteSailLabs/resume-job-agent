# ASu content quality and RenderCV templates

## Integration boundary

Resume Matcher remains the primary application and source of truth for resume
records, jobs, editing, batch generation, API routes, and the web interface.
This integration does not introduce a second editor, database, or workflow.

The handoff is deliberately narrow:

1. Resume Matcher produces and stores its existing `ResumeData` JSON.
2. ASu-inspired rules constrain generation and run deterministic claim/evidence
   checks against the original resume and job keywords.
3. A stored `render_profile` selects presentation independently from content.
4. The adapter maps `ResumeData` to RenderCV and returns a text-based PDF.

Changing a template updates only `render_profile`; it never invokes the LLM or
rewrites resume content.

## Upstream provenance

- Primary foundation: the existing local Resume Matcher project and all of its
  established product workflows.
- Content-method reference: `Hisn00w/ASu-skills`, commit
  `d175f283972515480b48faaad5c8cb7587821b5b`, MIT License. Adapted concepts:
  claim/evidence boundaries, conservative ownership language, page-balance
  guidance, and evidence-first ordering.
- Rendering engine: `rendercv/rendercv`, commit
  `1d4b87bc427e4cf61c0ef49623c971b0e2224708`; runtime dependency
  `rendercv[full]==2.8`, MIT License.
- RenderCV's optional Typst Font Awesome package is packaged locally for
  deterministic offline rendering. It is from `duskmoon314/typst-fontawesome`,
  commit `21afe7e7e4e2019d1dc96976771dfedd5e0f632d`, MIT License; its original
  license is retained beside the copied assets.

## Reused and added components

Reused from Resume Matcher:

- resume and job persistence;
- upload, parsing, tailoring, editing, and resume-library flows;
- existing frontend shell and legacy React templates;
- batch-generation task model and API conventions.

Added as thin adapters:

- ASu-inspired prompt guardrails and explainable quality report;
- RenderCV JSON adapter and four curated template profiles;
- persisted default template and template-only update endpoint;
- PDF preview/download that uses the selected stored profile.

## Intentionally out of scope

- copying ASu's full agent or creating an additional resume application;
- replacing Resume Matcher's editor or database;
- inventing metrics, ownership, skills, or experience absent from the source;
- rerunning the LLM when the user only switches visual templates.
