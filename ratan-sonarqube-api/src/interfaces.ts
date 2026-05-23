import { z } from "zod";

export const PeriodSchema = z.object({
  index: z.number(),
  value: z.string(),
  bestValue: z.boolean(),
});

export type Period = z.infer<typeof PeriodSchema>;

export const MeasureSchema = z.object({
  metric: z.string(),
  value: z.string().optional(),
  period: PeriodSchema,
});

export type Measure = z.infer<typeof MeasureSchema>;

export const ComponentSchema = z.object({
  key: z.string(),
  name: z.string(),
  qualifier: z.string(),
  measures: z.array(MeasureSchema),
  pullRequest: z.string(),
});

export type Component = z.infer<typeof ComponentSchema>;

export const MetricSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  domain: z.string(),
  type: z.string(),
  higherValuesAreBetter: z.boolean(),
  qualitative: z.boolean(),
  hidden: z.boolean(),
  decimalScale: z.number().optional(),
  bestValue: z.string(),
  worstValue: z.string().optional(),
});

export type Metric = z.infer<typeof MetricSchema>;

export const MeasuresComponentSchema = z.object({
  component: ComponentSchema,
  metrics: z.array(MetricSchema),
});

export type MeasuresComponent = z.infer<typeof MeasuresComponentSchema>;

export const ParsedMeasuresComponentSchema = z
  .object({
    alert_status: z.string(),
    branch_coverage: z.number(),
    bugs: z.number(),
    classes: z.number(),
    code_smells: z.number(),
    cognitive_complexity: z.number(),
    comment_lines: z.number(),
    comment_lines_density: z.number(),
    complexity: z.number(),
    conditions_by_line: z.number(),
    confirmed_issues: z.number(),
    coverage: z.number(),
    coverage_line_hits_data: z.number(),
    covered_conditions_by_line: z.number(),
    directories: z.number(),
    duplicated_blocks: z.number(),
    duplicated_files: z.number(),
    duplicated_lines: z.number(),
    duplicated_lines_density: z.number(),
    false_positive_issues: z.number(),
    files: z.number(),
    functions: z.number(),
    line_coverage: z.number(),
    lines: z.number(),
    lines_to_cover: z.number(),
    ncloc: z.number(),
    ncloc_language_distribution: z.string(),
    new_branch_coverage: z.number(),
    new_bugs: z.number(),
    new_code_smells: z.number(),
    new_coverage: z.number(),
    new_line_coverage: z.number(),
    new_lines_to_cover: z.number(),
    new_reliability_remediation_effort: z.number(),
    new_security_hotspots: z.number(),
    new_security_remediation_effort: z.number(),
    new_security_review_rating: z.number(),
    new_sqale_debt_ratio: z.number(),
    new_technical_debt: z.number(),
    new_uncovered_conditions: z.number(),
    new_uncovered_lines: z.number(),
    new_violations: z.number(),
    new_vulnerabilities: z.number(),
    new_software_quality_maintainability_rating: z.number(),
    new_software_quality_reliability_rating: z.number(),
    new_software_quality_security_rating: z.number(),
    open_issues: z.number(),
    projects: z.number(),
    quality_gate_details: z.string(),
    reliability_rating: z.number(),
    reliability_remediation_effort: z.number(),
    reopened_issues: z.number(),
    security_hotspots: z.number(),
    security_hotspots_reviewed: z.number(),
    security_rating: z.number(),
    security_remediation_effort: z.number(),
    security_review_rating: z.number(),
    software_quality_maintainability_issues: z.number(),
    software_quality_maintainability_rating: z.number(),
    software_quality_reliability_issues: z.number(),
    software_quality_reliability_rating: z.number(),
    software_quality_security_issues: z.number(),
    software_quality_security_rating: z.number(),
    skipped_tests: z.number(),
    sqale_debt_ratio: z.number(),
    sqale_index: z.number(),
    sqale_rating: z.number(),
    statements: z.number(),
    test_errors: z.number(),
    test_execution_time: z.number(),
    test_failures: z.number(),
    test_success_density: z.number(),
    tests: z.number(),
    uncovered_conditions: z.number(),
    uncovered_lines: z.number(),
    violations: z.number(),
    vulnerabilities: z.number(),
  })
  .strict();

export type ParsedMeasuresComponent = z.infer<
  typeof ParsedMeasuresComponentSchema
>;
