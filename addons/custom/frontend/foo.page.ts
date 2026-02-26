import { $, addPage, NamedPage, UserSelectAutoComplete, AutoloadPage } from '@hydrooj/ui-default'

const customCss = `
.submission-link {
    color: #5f9fd6 !important;
}

.theme--dark .submission-link {
    color: #55b6e2 !important;
}

.badge--lv0 {
    display: none !important;
}

.badge--lv1, .badge--lv2 {
    display: none !important;
}

.badge--lv3, .badge--lv4 {
    display: none !important;
}

.badge--lv5, .badge--lv6 {
    display: none !important;
}

.badge--lv7 {
    display: none !important;
}

.badge--lv8 {
    display: none !important;
}

.badge--lv9 {
    display: none !important;
}

.badge--lv10 {
    display: none !important;
}

.badge--lv11 {
    display: none !important;
}

a.user-profile-name.uname--lv1 {
    color: #808080 !important;
}

a.user-profile-name.uname--lv2 {
    color: #804000 !important;
}

a.user-profile-name.uname--lv3 {
    color: #008000 !important;
}

a.user-profile-name.uname--lv4 {
    color: #00c0c0 !important;
}

a.user-profile-name.uname--lv5 {
    color: #0000ff !important;
}

a.user-profile-name.uname--lv6 {
    color: #c0c000 !important;
}

a.user-profile-name.uname--lv7 {
    color: #ff8000 !important;
}

a.user-profile-name.uname--lv8 {
    color: #ff0000 !important;
}

a.user-profile-name.uname--lv11 {
    color: #c000c0 !important;
}

a.user-profile-name.uname--lv0 {
    color: #000000 !important;
}

html.theme--dark a.user-profile-name.uname--lv0 {
    color: #ffffff !important;
}

.theme--dark .section__tab-header-item {
    color: #d8e0e6 !important;
}

.theme--dark .problem__tag-item {
    color: #d8dee3;
}
.theme--dark .search-sort {
    color: #eee;
    background-color: #1f1f1f;
}

div:has(> .ConfigMonacoEditor) {
  overflow: hidden !important;
}

.ConfigMonacoEditor + .textbox {
    height: 100% !important;
}

.contest-type--sleepingcupcoder .contest-type-tag {
    background: #ed5f82
}

.contest-type--sleepingcupcoder .contest-type-tag:hover {
    background: #f695ac
}

.record-status--text.partial {
    color: #0cc!important
}

.record-status--border.partial {
    border-left: .1875rem solid #0cc
}

.record-status--icon.partial:before {
    content: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000'%3E%3Cpath d='m200 666 600 0 0 111-600 0 0-111z' fill='%230cc'/%3E%3C/svg%3E");
}
`;

addPage(new AutoloadPage('my_page_name', () => {
  const style = document.createElement('style');
    style.type = 'text/css';
    style.appendChild(document.createTextNode(customCss));
    document.head.appendChild(style);
}));

addPage(new NamedPage(['user_detail'], () => {
  draw();
}));
