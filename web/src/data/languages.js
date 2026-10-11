export const LANGUAGES = {
  java: {
    id: 'java',
    mimeType: 'text/x-java-source',
    label: 'Java',
    badge: 'J',
    color: '#3a7ca8',
    fileExt: '.java',
    lineComment: '//',
    blockComment: ['/*', '*/'],
    keywords: ['abstract','assert','boolean','break','byte','case','catch','char','class','const','continue','default','do','double','else','enum','extends','final','finally','float','for','goto','if','implements','import','instanceof','int','interface','long','native','new','package','private','protected','public','record','return','sealed','short','static','strictfp','super','switch','synchronized','this','throw','throws','transient','try','var','void','volatile','while','yield','permits'],
    literals: ['true','false','null'],
    types: ['String','Integer','Double','Float','Long','Short','Byte','Character','Boolean','Object','List','ArrayList','LinkedList','Map','HashMap','TreeMap','Set','HashSet','Void','Number','StringBuilder','StringBuffer','Optional','Exception','RuntimeException','Thread','Comparable','Iterable','Iterator']
  },
  python: {
    id: 'python',
    mimeType: 'text/x-python',
    label: 'Python',
    badge: 'Py',
    color: '#4b8bbe',
    fileExt: '.py',
    lineComment: '#',
    blockComment: null,
    keywords: ['and','as','assert','async','await','break','case','class','continue','def','del','elif','else','except','finally','for','from','global','if','import','in','is','lambda','match','nonlocal','not','or','pass','raise','return','try','while','with','yield'],
    literals: ['True','False','None'],
    types: ['int','str','float','bool','list','dict','set','tuple','object']
  },
  html: {
    id: 'html',
    mimeType: 'text/html',
    label: 'HTML',
    badge: '<>',
    color: '#e44d26',
    fileExt: '.html',
    extensions: ['.html', '.htm'],
    lineComment: null,
    blockComment: ['<!--', '-->'],
    keywords: ['DOCTYPE'],
    literals: [],
    types: ['html','head','body','title','meta','link','style','script','header','main','footer','nav','section','article','aside','div','span','p','a','img','picture','source','button','input','textarea','select','option','label','form','table','thead','tbody','tr','th','td','ul','ol','li','h1','h2','h3','h4','h5','h6','canvas','svg','template']
  }
};
