alter table public.products
  add column if not exists old_price numeric(12,2),
  add column if not exists categories text[] not null default '{}',
  add column if not exists kind text,
  add column if not exists badge text,
  add column if not exists badge_class text not null default '',
  add column if not exists description text,
  add column if not exists specs jsonb not null default '[]'::jsonb,
  add column if not exists sort_order integer not null default 0;

update public.products set
  old_price = 99.90,
  categories = array['hand','car','maintenance'],
  kind = 'כלי עבודה · אביזרי רכב · תחזוקה',
  badge = '🔥 נמכר ביותר',
  badge_class = '',
  description = 'סט קומפקטי ושימושי לרכב, לבית ולמוסך עם ראצ׳ט 1/4, בוקסות, ביטים ומאריכים.',
  specs = '["46 חלקים","ראצ׳ט 1/4 אינץ׳","בוקסות וביטים","מזוודת אחסון קשיחה"]'::jsonb,
  sort_order = 10,
  updated_at = now()
where id = 'socket';

update public.products set
  old_price = null,
  categories = array['power','car','maintenance'],
  kind = 'כלים חשמליים · אביזרי רכב · תחזוקה',
  badge = 'תואם Makita',
  badge_class = '',
  description = 'גוף בלבד ללא סוללה. ראצ׳ט קומפקטי לעבודה במקומות צפופים ולתחזוקת רכב.',
  specs = '["גוף בלבד — ללא סוללה","מבנה זוויתי","מתאים לעבודות תחזוקה","תואם סוללות Makita לפי הדגם"]'::jsonb,
  sort_order = 20,
  updated_at = now()
where id = 'ratchet';

update public.products set
  old_price = 105.68,
  categories = array['power','car','maintenance'],
  kind = 'כלים חשמליים · אביזרי רכב',
  badge = 'חדש · 520Nm',
  badge_class = 'red',
  description = 'מפתח אימפקט אלחוטי לעבודות רכב ותחזוקה. גוף בלבד ללא סוללה.',
  specs = '["18V","מומנט עד 520Nm","גוף בלבד — ללא סוללה","מתאים לעבודות רכב ותחזוקה"]'::jsonb,
  sort_order = 30,
  updated_at = now()
where id = 'impact';

update public.products set
  old_price = 142.05,
  categories = array['power'],
  kind = 'כלים חשמליים · סוללות ומטענים',
  badge = 'סוללה + מטען',
  badge_class = '',
  description = 'ערכת סוללת ליתיום נטענת 588VF עם מטען, תואמת למגוון כלי עבודה 18V בסגנון Makita B-Series.',
  specs = '["סוללה 588VF","כולל מטען","מתח עבודה 18–21V לפי היצרן","תואם לדגמי Makita B-Series נבחרים — יש לוודא התאמה לפני הזמנה"]'::jsonb,
  sort_order = 40,
  updated_at = now()
where id = 'battery588';

update public.products set
  old_price = null,
  categories = array['power','car','maintenance'],
  kind = 'כלים חשמליים · אביזרי רכב · תחזוקה',
  badge = 'Set 1',
  badge_class = '',
  description = 'מכונת שטיפה אלחוטית ניידת לשטיפת רכב, חצר ותחזוקה שוטפת. הווריאנט שנבחר להזמנה הוא Set 1.',
  specs = '["זמין להזמנה","Set 1"]'::jsonb,
  sort_order = 50,
  updated_at = now()
where id = 'washer';

create index if not exists products_sort_order_idx on public.products(sort_order);
