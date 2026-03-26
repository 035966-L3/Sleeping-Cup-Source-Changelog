import './bugfix.css';
import { addPage, NamedPage } from '@hydrooj/ui-default';

addPage(new NamedPage(['problem_config'], () => {
  trigger();
}));
