import { addPage, NamedPage } from '@hydrooj/ui-default';

addPage(new NamedPage(['bogo'], () => {
  operationCountdown();
  refreshProcess();
}));

addPage(new NamedPage(['bogo_congrats'], () => {
  climbAmount();
}));
