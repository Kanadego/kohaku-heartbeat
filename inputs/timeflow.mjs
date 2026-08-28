// 琥珀的心跳 · 时间流（纯时间函数，零 IO 零隐私采集）
// 产出：星期/时段/节日上下文 + 节日当天的一条候选素材

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 公历固定纪念日（农历节日待有需要再补换算表）
const FESTIVALS = {
  '01-01': '元旦',
  '02-14': '情人节',
  '03-08': '妇女节',
  '04-01': '愚人节',
  '05-01': '劳动节',
  '05-04': '青年节',
  '06-01': '儿童节',
  '09-10': '教师节',
  '10-01': '国庆节',
  '10-24': '程序员节',
  '12-24': '平安夜',
  '12-25': '圣诞节',
};

function daypart(h) {
  if (h < 6) return '深夜';
  if (h < 9) return '清晨';
  if (h < 12) return '上午';
  if (h < 14) return '正午';
  if (h < 18) return '午后';
  if (h < 22) return '夜晚';
  return '夜里';
}

export default function collect(_policy, now = new Date()) {
  const weekday = WEEKDAYS[now.getDay()];
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  const part = daypart(now.getHours());
  const key = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const festival = FESTIVALS[key] || null;

  const items = [];
  if (festival) items.push({ text: `今天是${festival}(${key})`, weight: 1 });

  return {
    source: '时间',
    items,
    context: { weekday, is_weekend: isWeekend, daypart: part,
      festival, date_key: key },
  };
}
