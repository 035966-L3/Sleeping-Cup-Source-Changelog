import './rating.css';
import { addPage, NamedPage } from '@hydrooj/ui-default';

addPage(new NamedPage(['user_detail'], () => {
  draw();
}));
