import type { ClusterDigestStatus } from '../api';
import { pillClass } from '../format';

type Props = {
  status: ClusterDigestStatus;
};

export default function StatusPill({ status }: Props) {
  return <span className={pillClass(status)}>{status.status_label}</span>;
}
