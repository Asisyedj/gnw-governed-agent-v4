CREATE TABLE public.gnw_ci_rollback_drill (
  id INTEGER PRIMARY KEY,
  marker TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.gnw_ci_rollback_drill(id, marker) VALUES (1, 'disposable-ci-only');
