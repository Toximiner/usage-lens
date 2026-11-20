import { decorate } from './helper';
export const Tag = () => <span>{decorate(' Library ')}</span>;
const panel = <Tag />;
