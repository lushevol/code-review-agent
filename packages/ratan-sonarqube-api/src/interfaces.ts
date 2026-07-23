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

const ParsedMeasureNumberSchema = z.number().refine(Number.isFinite);
const ParsedMeasureStringSchema = z.string();

export const ParsedMeasuresComponentSchema = z
  .object({
    alert_status: ParsedMeasureStringSchema,
    branch_coverage: ParsedMeasureNumberSchema,
    bugs: ParsedMeasureNumberSchema,
    classes: ParsedMeasureNumberSchema,
    code_smells: ParsedMeasureNumberSchema,
    cognitive_complexity: ParsedMeasureNumberSchema,
    comment_lines: ParsedMeasureNumberSchema,
    comment_lines_density: ParsedMeasureNumberSchema,
    complexity: ParsedMeasureNumberSchema,
    conditions_by_line: ParsedMeasureStringSchema,
    conditions_to_cover: ParsedMeasureNumberSchema,
    confirmed_issues: ParsedMeasureNumberSchema,
    coverage: ParsedMeasureNumberSchema,
    coverage_line_hits_data: ParsedMeasureStringSchema,
    covered_conditions_by_line: ParsedMeasureStringSchema,
    directories: ParsedMeasureNumberSchema,
    duplicated_blocks: ParsedMeasureNumberSchema,
    duplicated_files: ParsedMeasureNumberSchema,
    duplicated_lines: ParsedMeasureNumberSchema,
    duplicated_lines_density: ParsedMeasureNumberSchema,
    false_positive_issues: ParsedMeasureNumberSchema,
    files: ParsedMeasureNumberSchema,
    functions: ParsedMeasureNumberSchema,
    line_coverage: ParsedMeasureNumberSchema,
    lines: ParsedMeasureNumberSchema,
    lines_to_cover: ParsedMeasureNumberSchema,
    ncloc: ParsedMeasureNumberSchema,
    ncloc_language_distribution: ParsedMeasureStringSchema,
    new_branch_coverage: ParsedMeasureNumberSchema,
    new_bugs: ParsedMeasureNumberSchema,
    new_code_smells: ParsedMeasureNumberSchema,
    new_coverage: ParsedMeasureNumberSchema,
    new_line_coverage: ParsedMeasureNumberSchema,
    new_lines_to_cover: ParsedMeasureNumberSchema,
    new_reliability_remediation_effort: ParsedMeasureNumberSchema,
    new_security_hotspots: ParsedMeasureNumberSchema,
    new_security_remediation_effort: ParsedMeasureNumberSchema,
    new_security_review_rating: ParsedMeasureNumberSchema,
    new_sqale_debt_ratio: ParsedMeasureNumberSchema,
    new_technical_debt: ParsedMeasureNumberSchema,
    new_uncovered_conditions: ParsedMeasureNumberSchema,
    new_uncovered_lines: ParsedMeasureNumberSchema,
    new_violations: ParsedMeasureNumberSchema,
    new_vulnerabilities: ParsedMeasureNumberSchema,
    new_software_quality_maintainability_rating: ParsedMeasureNumberSchema,
    new_software_quality_reliability_rating: ParsedMeasureNumberSchema,
    new_software_quality_security_rating: ParsedMeasureNumberSchema,
    open_issues: ParsedMeasureNumberSchema,
    projects: ParsedMeasureNumberSchema,
    quality_gate_details: ParsedMeasureStringSchema,
    reliability_rating: ParsedMeasureNumberSchema,
    reliability_remediation_effort: ParsedMeasureNumberSchema,
    reopened_issues: ParsedMeasureNumberSchema,
    security_hotspots: ParsedMeasureNumberSchema,
    security_hotspots_reviewed: ParsedMeasureNumberSchema,
    security_rating: ParsedMeasureNumberSchema,
    security_remediation_effort: ParsedMeasureNumberSchema,
    security_review_rating: ParsedMeasureNumberSchema,
    software_quality_maintainability_issues: ParsedMeasureNumberSchema,
    software_quality_maintainability_rating: ParsedMeasureNumberSchema,
    software_quality_reliability_issues: ParsedMeasureNumberSchema,
    software_quality_reliability_rating: ParsedMeasureNumberSchema,
    software_quality_security_issues: ParsedMeasureNumberSchema,
    software_quality_security_rating: ParsedMeasureNumberSchema,
    skipped_tests: ParsedMeasureNumberSchema,
    sqale_debt_ratio: ParsedMeasureNumberSchema,
    sqale_index: ParsedMeasureNumberSchema,
    sqale_rating: ParsedMeasureNumberSchema,
    statements: ParsedMeasureNumberSchema,
    test_errors: ParsedMeasureNumberSchema,
    test_execution_time: ParsedMeasureNumberSchema,
    test_failures: ParsedMeasureNumberSchema,
    test_success_density: ParsedMeasureNumberSchema,
    tests: ParsedMeasureNumberSchema,
    uncovered_conditions: ParsedMeasureNumberSchema,
    uncovered_lines: ParsedMeasureNumberSchema,
    violations: ParsedMeasureNumberSchema,
    vulnerabilities: ParsedMeasureNumberSchema,
  })
  .partial()
  .strict();

export type ParsedMeasuresComponent = z.infer<
  typeof ParsedMeasuresComponentSchema
>;
