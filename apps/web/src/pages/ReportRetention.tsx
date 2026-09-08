export type ReportRetentionData = {
  state: string;
  delete_after: string | null;
  retention_hold: boolean | null;
  deleted_at: string | null;
};
export function reportIsRetained(report: ReportRetentionData) {
  if (report.deleted_at || ["DELETING", "DELETED"].includes(report.state)) return false;
  return (
    report.retention_hold === true ||
    (report.delete_after !== null && Date.parse(report.delete_after) > Date.now())
  );
}
export function ReportRetention({ report }: { report: ReportRetentionData }) {
  if (report.deleted_at || report.state === "DELETED")
    return (
      <small>The encrypted report is deleted. Report hashes and financial receipts remain.</small>
    );
  if (!reportIsRetained(report)) return <small>The report retention period has ended.</small>;
  if (report.retention_hold)
    return (
      <small>
        Retained during settlement. Export within 30 days after payment and report release.
      </small>
    );
  if (!report.delete_after) return <small>The report expiry date is unavailable.</small>;
  return <small>Export before {new Date(report.delete_after).toLocaleString()}.</small>;
}
