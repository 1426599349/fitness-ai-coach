"""
健身AI助手 网页版后端
完全复刻小程序 aiChat + userInit 云函数逻辑
"""
import json, sys, os, importlib, re, urllib.request as urlreq
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shared.db import db
from mcp.orchestrator import orchestrator
from harness.validator import check_medical_redline

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')
STATE = {'GREETING': 'greeting', 'ONBOARDING': 'onboarding', 'READY': 'ready'}

# ===== DeepSeek API 配置（复刻小程序 AI_CONFIG）=====
AI_CONFIG = {
    'apiKey': os.environ.get('DEEPSEEK_API_KEY', 'sk-23b30e647df245009e4b190be43e41b1'),
    'url': 'https://api.deepseek.com/v1/chat/completions',
    'model': 'deepseek-chat',
}

def callAI(messages, temperature=0.7, max_tokens=2000):
    body = json.dumps({
        'model': AI_CONFIG['model'],
        'messages': messages,
        'temperature': temperature,
        'max_tokens': max_tokens,
    }).encode('utf-8')
    req = urlreq.Request(AI_CONFIG['url'], data=body, headers={
        'Content-Type': 'application/json',
        'Authorization': f"Bearer {AI_CONFIG['apiKey']}",
        'Accept': 'application/json',
    })
    resp = urlreq.urlopen(req, timeout=25)
    data = json.loads(resp.read())
    if 'error' in data:
        return data['error'].get('message', 'AI API error')
    return data['choices'][0]['message']['content']


def _import_skill(module_name, func_name):
    mod = importlib.import_module(f'skills.{module_name}')
    return getattr(mod, func_name)


# ===== 意图识别（复刻小程序 detectIntent）=====
def detect_intent(message, has_profile):
    msg = message.lower().strip()
    if not has_profile:
        # 尝试从输入中提取身体数据
        return 'onboarding'
    if re.search(r'^换一换$|^换个$|^换餐$|^再来', msg): return 'regenerate_meal'
    if re.search(r'^今天吃什么$|^今日饮食$|^餐单$', msg): return 'meal'
    if re.search(r'^训练计划$|^健身方案$', msg): return 'workout'
    if re.search(r'^更新体重', msg): return 'checkin'
    if re.search(r'身高|体重|年龄|公斤|kg|cm|减脂|增肌|塑形', message) and re.search(r'\d', message):
        return 'onboarding'
    return 'general'


# ===== 身体数据解析（复刻小程序 quickParse）=====
def parse_body_data(text):
    nums = re.findall(r'\d{2,3}', text)
    if len(nums) < 2: return None
    h, w = int(nums[0]), int(nums[1])
    a = int(nums[2]) if len(nums) > 2 else 25
    if h < 100 or w < 20: return None
    return {
        'height_cm': h, 'weight_kg': w, 'age': a,
        'gender': 'female' if '女' in text else 'male',
        'fitness_goal': 'fat_loss' if any(x in text for x in ['减脂','减肥']) else
                        'muscle_gain' if '增肌' in text else
                        'shape' if '塑形' in text else 'maintain',
        'place': 'gym' if '健身房' in text else 'home',
    }


class Handler(BaseHTTPRequestHandler):
    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _static(self, fp, ct='text/html; charset=utf-8'):
        full = os.path.join(STATIC, fp.lstrip('/'))
        if not os.path.isfile(full): self.send_error(404); return
        with open(full,'rb') as f: data = f.read()
        self.send_response(200)
        self.send_header('Content-Type',ct)
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read(self):
        l = int(self.headers.get('Content-Length',0))
        if l == 0: return {}
        return json.loads(self.rfile.read(l).decode('utf-8'))

    # ===== ROUTES =====
    def do_GET(self):
        p = urlparse(self.path).path
        qs = parse_qs(urlparse(self.path).query)
        uid = qs.get('uid',[''])[0]
        if p in ('/','/index.html'): self._static('/index.html')
        elif p == '/api/user': self._json(self._get_user(uid))
        elif p == '/api/user/credits': self._json(self._get_credits(uid))
        elif p == '/api/user/weight': self._json(self._get_weight_history(uid))
        else: self.send_error(404)

    def do_POST(self):
        p = urlparse(self.path).path
        body = self._read()
        if p == '/api/chat': self._chat(body)
        elif p == '/api/user/update': self._json(self._update_profile(body))
        elif p == '/api/user/signin': self._json(self._do_signin(body.get('uid','')))
        elif p == '/api/feedback': self._json(self._do_feedback(body))
        elif p == '/api/wheel': self._json(self._meal_wheel(body))
        elif p == '/api/memory/clear': self._json(self._clear_memory(body.get('uid','')))
        elif p == '/api/admin/stats': self._json(self._admin_stats(body.get('password','')))
        else: self._json({'error':'not found'},404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.end_headers()

    # ===== USER API =====
    def _get_user(self, uid):
        if not uid: return {'success':False}
        p = db.get_user(uid)
        if not p: return {'success':False,'message':'用户不存在'}
        return {'success':True,'profile':{'height_cm':p.height_cm,'weight_kg':p.weight_kg,'age':p.age,'gender':p.gender,'fitness_goal':p.fitness_goal,'fitness_level':p.fitness_level,'activity_level':p.activity_level,'allergies':p.allergies,'place':p.place,'likedFoods':getattr(p,'likedFoods',None) or getattr(p,'liked_foods',None) or []}}

    def _update_profile(self, body):
        uid = body.get('uid','')
        if not uid: return {'success':False}
        p = db.get_user(uid)
        if not p:
            db.save_user_profile(uid,{'height_cm':body.get('height_cm',170),'weight_kg':body.get('weight_kg',70),'age':body.get('age',25),'gender':body.get('gender','male'),'fitness_goal':body.get('fitness_goal','maintain'),'fitness_level':body.get('fitness_level','beginner'),'activity_level':'moderate','allergies':body.get('allergies',[]),'place':body.get('place','home')})
        else:
            conn = db._conn
            for f in ['height_cm','weight_kg','age','gender','fitness_goal','fitness_level','place']:
                if f in body: conn.execute(f'UPDATE users SET {f}=? WHERE user_id=?',(body[f],uid))
            if 'allergies' in body: conn.execute('UPDATE users SET allergies=? WHERE user_id=?',(json.dumps(body['allergies'],ensure_ascii=False),uid))
            if 'likedFoods' in body:
                try: conn.execute('UPDATE users SET liked_foods=? WHERE user_id=?',(json.dumps(body['likedFoods'],ensure_ascii=False),uid))
                except: pass
            conn.commit()
        return {'success':True}

    def _do_signin(self, uid):
        if not uid: return {'success':False}
        td = date.today().isoformat()
        conn = db._conn
        try: conn.execute('ALTER TABLE users ADD COLUMN last_signin TEXT')
        except: pass
        row = conn.execute('SELECT credits,last_signin FROM users WHERE user_id=?',(uid,)).fetchone()
        if not row: return {'success':False,'message':'请先录入身体数据'}
        if row['last_signin'] == td: return {'success':True,'credits':row['credits'],'signed':False,'message':'今日已签到'}
        newc = (row['credits'] or 200) + 20
        conn.execute('UPDATE users SET credits=?,last_signin=? WHERE user_id=?',(newc,td,uid)); conn.commit()
        return {'success':True,'credits':newc,'signed':True}

    def _get_credits(self, uid):
        conn = db._conn
        try: conn.execute('ALTER TABLE users ADD COLUMN last_signin TEXT')
        except: pass
        row = conn.execute('SELECT credits,last_signin FROM users WHERE user_id=?',(uid,)).fetchone()
        if not row: return {'credits':200,'signed':False}
        return {'credits':row['credits'] or 200,'signed':row['last_signin']==date.today().isoformat()}

    def _get_weight_history(self, uid):
        recs = db.get_weight_history(uid)
        return {'success':True,'history':[{'weight_kg':r.weight_kg,'date':r.date} for r in recs]}

    def _do_feedback(self, body):
        content = body.get('content','').strip()
        if not content: return {'success':False}
        conn = db._conn
        conn.execute('''CREATE TABLE IF NOT EXISTS feedbacks(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT,content TEXT,created_at TEXT,resolved INTEGER DEFAULT 0)''')
        conn.execute('INSERT INTO feedbacks(user_id,content,created_at) VALUES(?,?,?)',(body.get('uid',''),content,date.today().isoformat())); conn.commit()
        return {'success':True}

    def _clear_memory(self, uid):
        db._conn.execute('DELETE FROM memory WHERE user_id=?',(uid,)); db._conn.commit()
        return {'success':True}

    def _admin_stats(self, pw):
        if pw != '315315zjh': return {'success':False,'message':'密码错误'}
        conn = db._conn; td = date.today().isoformat()
        try: total = conn.execute('SELECT COUNT(*) as c FROM users').fetchone()['c']
        except: total = 0
        try: signin = conn.execute('SELECT COUNT(*) as c FROM users WHERE last_signin=?',(td,)).fetchone()['c']
        except: signin = 0
        try: fb = conn.execute('SELECT COUNT(*) as c FROM feedbacks').fetchone()['c']
        except: fb = 0
        return {'success':True,'totalUsers':total,'todaySignin':signin,'feedbacks':fb}

    # ===== CHAT — 完全复刻小程序 exports.main =====
    def _chat(self, body):
        uid = body.get('user_id','web_user_001')
        msg = body.get('message','').strip()
        if not msg: return self._json({'success':False,'error':'empty'})

        # 医疗红线
        redline = check_medical_redline(msg)
        if redline['blocked']:
            return self._json({'type':'text','content':'你好，我是健身饮食助手，不提供医疗建议。如有健康问题，请咨询专业医生。','blocked':True})

        # 积分扣减
        conn = db._conn
        try: conn.execute('ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 200')
        except: pass
        row = conn.execute('SELECT credits FROM users WHERE user_id=?',(uid,)).fetchone()
        credits = (row['credits'] if row else 200) or 200

        profile = db.get_user(uid)
        intent = detect_intent(msg, profile is not None)

        if intent != 'onboarding':
            if credits < 5:
                return self._json({'type':'text','content':f'积分不足！（当前{credits}分）\n\n每日签到可领取20积分','credits':credits,'needCredits':True})
            credits -= 5
            if row: conn.execute('UPDATE users SET credits=? WHERE user_id=?',(credits,uid)); conn.commit()

        # 执行意图
        result = None
        if intent == 'onboarding':
            result = self._handle_onboarding(uid, msg, profile)
        elif intent == 'meal':
            result = self._handle_meal(uid)
        elif intent == 'regenerate_meal':
            result = self._handle_regenerate(uid)
        elif intent == 'workout':
            result = self._handle_workout(uid)
        elif intent == 'checkin':
            result = self._handle_checkin(uid, msg)
        else:
            result = self._handle_general(uid, msg)

        result['credits'] = credits
        self._save_memory(uid, msg, str(result.get('content',''))[:200])
        return self._json(result)

    # ===== 意图处理（复刻小程序 handler 函数）=====
    def _handle_onboarding(self, uid, msg, profile):
        # 尝试自然语言解析
        parsed = parse_body_data(msg)
        if not parsed or not parsed.get('height_cm'):
            # 检查是否选了场所但没身体数据
            if '健身房' in msg or '居家' in msg or '家里' in msg:
                return {'type':'text','content':'好的，已记录。\n现在请告诉我你的身体数据~\n比如：170cm，75kg，28岁，想减脂'}
            return {'type':'text','content':'请填写你的身体数据~\n比如：170 75 男 25 减脂 居家'}

        user_data = {
            'user_id': uid, 'height_cm': parsed['height_cm'], 'weight_kg': parsed['weight_kg'],
            'age': parsed['age'], 'gender': parsed['gender'],
            'fitness_goal': parsed['fitness_goal'], 'fitness_level': 'beginner',
            'activity_level': 'moderate', 'allergies': [], 'place': parsed['place'],
        }
        result = orchestrator.new_user_init(user_data)
        if result.get('success'):
            m = result.get('metrics',{})
            wp = result.get('workout_plan',{})

            # 构建计划摘要
            plan_lines = ['训练计划（7天）：']
            for day in wp.get('schedule',[]):
                if day.get('focus') == '休息' or day.get('rest'):
                    plan_lines.append(f"  {day.get('label','')} 休息日")
                else:
                    exs = ', '.join([e['name'] for e in day.get('exercises',[])])
                    plan_lines.append(f"  {day.get('label','')} {day.get('focus')}：{exs}")

            result['type'] = 'text'
            result['content'] = (
                f"已为你生成专属计划！\n\n"
                f"📊 BMI {m.get('bmi','?')} · 每日消耗 {m.get('tdee','?')} kcal\n"
                f"🎯 推荐摄入 {m.get('recommended_intake','?')} kcal · "
                f"蛋白{m.get('protein_g','?')}g 脂肪{m.get('fat_g','?')}g 碳水{m.get('carb_g','?')}g\n\n"
                + '\n'.join(plan_lines) +
                f"\n\n去「本周计划」页查看详情~"
            )
        return result

    def _handle_meal(self, uid):
        today = date.today().isoformat()
        r = orchestrator.daily_meal_flow(uid, today)
        m = r.get('meal',{})
        dishes = ', '.join([f"{d['name']}{d['grams']}g" for d in m.get('dishes',[])]) if m.get('dishes') else ''
        return {
            'success': True,
            'type': 'text',
            'content': f"🍽️ 今日饮食\n\n🍚 {m.get('main_staple','')}\n🥘 {dishes}\n🔥 总热量 {m.get('total_kcal','')} kcal\n蛋白质 {m.get('protein_g','')}g · 脂肪 {m.get('fat_g','')}g · 碳水 {m.get('carb_g','')}g",
            'meal': m
        }

    def _handle_regenerate(self, uid):
        today = date.today().isoformat()
        r = orchestrator.regenerate_meal(uid, today)
        m = r.get('meal',{})
        dishes = ', '.join([f"{d['name']}{d['grams']}g" for d in m.get('dishes',[])]) if m.get('dishes') else ''
        return {
            'success': True,
            'type': 'text',
            'content': f"🔄 已换新餐单！\n\n🍚 {m.get('main_staple','')}\n🥘 {dishes}\n🔥 总热量 {m.get('total_kcal','')} kcal",
            'meal': m, 'regenerated': True
        }

    def _handle_workout(self, uid):
        plan = db.get_latest_workout(uid)
        if not plan:
            return {'success':False,'type':'text','content':'请先录入身体数据生成计划'}
        lines = ['训练计划：']
        for day in plan.schedule:
            if day.get('focus')=='休息' or day.get('rest'):
                lines.append(f"  {day.get('label','')} 休息日")
            else:
                exs = ', '.join([e['name'] for e in day.get('exercises',[])])
                lines.append(f"  {day.get('label','')} {day.get('focus')}：{exs}")
        return {'success':True,'type':'text','content':'\n'.join(lines),'schedule':plan.schedule,'place':plan.place}

    def _handle_checkin(self, uid, msg):
        nums = re.findall(r'\d{2,3}(?:\.\d)?', msg)
        if not nums:
            return {'success':True,'type':'text','content':'请输入你的最新体重（kg）','action':'checkin'}
        new_w = float(nums[0])
        profile = db.get_user(uid)
        old_w = profile.weight_kg if profile else new_w
        change = ((new_w - old_w) / old_w * 100) if old_w > 0 else 0
        need_update = abs(change) > 2
        db.update_user_weight(uid, new_w)
        if need_update:
            from mcp.orchestrator import orchestrator
            orchestrator.weekly_checkin_flow(uid, new_w)
            return {'success':True,'type':'text','content':f'体重变化{abs(change):.1f}%，超过2%，已为你更新训练方案！'}
        return {'success':True,'type':'text','content':'体重变化平稳，继续执行原计划~'}

    def _handle_general(self, uid, msg):
        profile = db.get_user(uid)
        if not profile:
            return {'type':'text','content':'请先录入身体数据~\n如：170 70 男 25 减脂 居家'}

        # 获取当前计划摘要
        plan = db.get_latest_workout(uid)
        current_plan = '暂无'
        if plan:
            current_plan = ' | '.join([
                f"{d.get('label','')} {'休息' if d.get('rest') or d.get('focus')=='休息' else d.get('focus','')+': '+','.join([e['name'] for e in d.get('exercises',[])])}"
                for d in plan.schedule
            ])

        # 加载对话记忆
        mem_rows = db._conn.execute('SELECT * FROM memory WHERE user_id=? ORDER BY id DESC LIMIT 12', (uid,)).fetchall()
        mem_text = ''
        if mem_rows:
            mem_text = '\n'.join([f"{'用户' if r['role']=='user' else 'AI'}：{r['content']}" for r in reversed(mem_rows)])

        try:
            ai_reply = callAI([
                {'role': 'system', 'content': f"""你是智能健身管家"小养"。输出纯JSON，不要markdown。

用户：{profile.gender=='male' and '男' or '女'} {profile.age}岁 {profile.height_cm}cm {profile.weight_kg}kg
目标：{profile.fitness_goal} 场所：{profile.place} 体能：{profile.fitness_level}

当前计划：{current_plan}
对话记忆：{mem_text[:500]}

自主判断用户意图：
- 闲聊/咨询 → 只回复，plan填null
- 要改动作/难度/计划/目标 → 生成新的完整7天计划

JSON格式：{{"reply":"回复(100字内)","plan":null}}
要更新计划时：{{"reply":"已调整~","plan":{{"days":[{{"label":"Day1","focus":"胸+三头","exercises":[{{"name":"俯卧撑","sets":3,"reps":12,"weight":0,"notes":""}}]}},{{"label":"Day2"...}},{{"label":"Day3","focus":"休息","exercises":[]}},...]}}}}"""},
                {'role': 'user', 'content': msg},
            ], temperature=0.7, max_tokens=2000)

            data = json.loads(ai_reply) if isinstance(ai_reply, str) else ai_reply
            reply = data.get('reply', ai_reply)

            if data.get('plan') and data['plan'].get('days'):
                labels = ['Day1','Day2','Day3','Day4','Day5','Day6','Day7']
                days = []
                for i, label in enumerate(labels):
                    found = next((d for d in data['plan']['days'] if d.get('label')==label), None)
                    if found:
                        rest = not found.get('exercises') or len(found.get('exercises',[]))==0
                        days.append({'label':label,'day':i+1,'focus':found.get('focus','训练'),'rest':rest,
                            'exercises':[{'name':e['name'],'sets':e.get('sets',3),'reps':e.get('reps',10),'weight':e.get('weight',0),'notes':e.get('notes','')} for e in found.get('exercises',[])]})
                    else:
                        days.append({'label':label,'day':i+1,'focus':'休息' if i==2 or i>=5 else '训练','rest':i==2 or i>=5,'exercises':[]})

                db._conn.execute('INSERT INTO workout_plans(user_id,plan_data,version,created_date) VALUES(?,?,?,?)',
                    (uid, json.dumps(days,ensure_ascii=False), 1, date.today().isoformat()))
                db._conn.commit()

                plan_text = '\n'.join([f"{d['label']} {'休息' if d['rest'] else d['focus']+'：'+','.join([e['name'] for e in d['exercises']])}" for d in days])
                return {'success':True,'type':'text','content':reply+'\n\n计划已更新：\n'+plan_text,'workout_plan':{'schedule':days,'place':profile.place},'planUpdated':True}

            return {'success':True,'type':'text','content':reply}
        except Exception as e:
            print(f'DeepSeek error: {e}')
            return {'success':True,'type':'text','content':'收到~ 你可以：\n• 今天吃什么\n• 训练计划\n• 换一换\n• 更新体重'}

    def _meal_wheel(self, body):
        uid = body.get('user_id','web_user_001')
        profile = db.get_user(uid)
        if not profile or not profile.height_cm:
            return {'success':False,'message':'请先录入身体数据'}

        m = _import_skill('人体指标测算 Skill', 'calculate_metrics')(
            profile.height_cm, profile.weight_kg, profile.age,
            profile.gender, profile.fitness_goal, profile.activity_level)

        allergies = profile.allergies or []
        liked = getattr(profile,'liked_foods',None) or getattr(profile,'likedFoods',None) or []
        allergy_str = '忌口：'+','.join(allergies)+'，绝对不能出现。' if allergies else ''
        like_str = ('喜欢食材：'+','.join(liked)+'，优先使用。') if liked else ''

        try:
            ai = callAI([
                {'role':'system','content':f"""你是专业营养师。只输出JSON，不解释。
用户：{profile.gender=='male' and '男' or '女'} {profile.age}岁 {profile.height_cm}cm {profile.weight_kg}kg
BMI：{m['bmi']}，每日消耗：{m['tdee']}kcal，目标：{profile.fitness_goal}
{allergy_str} {like_str}

生成一日三餐(breakfast/lunch/dinner)，中式家常，每餐主食+2-3配菜，三餐主食不重复。纯JSON：
{{"breakfast":{{"main_staple":"主食 克数g","dishes":[{{"name":"菜名","grams":克,"kcal":热,"protein_g":蛋,"fat_g":脂,"carb_g":碳}}],"total_kcal":数字,"protein_g":蛋,"fat_g":脂,"carb_g":碳}},"lunch":{{...}},"dinner":{{...}}}}"""},
                {'role':'user','content':'生成一日三餐'},
            ], temperature=0.8, max_tokens=2000)

            data = json.loads(ai) if isinstance(ai, str) else ai
            meals = []
            for key in ['breakfast','lunch','dinner']:
                if data.get(key):
                    meals.append(data[key])
            return {'success':True,'meals':meals if meals else [{'main_staple':'生成失败','dishes':[],'total_kcal':0}]}
        except Exception as e:
            print(f'Wheel AI error: {e}')
            # Fallback
            staples=['红薯','意面','杂粮饭','玉米','全麦面包','饺子','燕麦','米粉']
            import random
            s1=random.choice(staples)
            s2=random.choice(staples)
            while s2==s1: s2=random.choice(staples)
            s3=random.choice(staples)
            while s3 in (s1,s2): s3=random.choice(staples)
            return {'success':True,'meals':[
                {'main_staple':s1+' 180g','dishes':[{'name':'番茄炒蛋','grams':120,'kcal':160},{'name':'蒜蓉西兰花','grams':100,'kcal':60}],'total_kcal':750,'protein_g':35,'fat_g':25,'carb_g':90},
                {'main_staple':s2+' 180g','dishes':[{'name':'青椒肉丝','grams':120,'kcal':180},{'name':'清炒菠菜','grams':100,'kcal':50}],'total_kcal':780,'protein_g':38,'fat_g':28,'carb_g':85},
                {'main_staple':s3+' 180g','dishes':[{'name':'卤牛肉','grams':100,'kcal':200},{'name':'凉拌黄瓜','grams':100,'kcal':40}],'total_kcal':720,'protein_g':40,'fat_g':22,'carb_g':80},
            ]}

    def _save_memory(self, uid, user_msg, ai_msg):
        conn = db._conn
        conn.execute('''CREATE TABLE IF NOT EXISTS memory(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT,role TEXT,content TEXT,created_at TEXT)''')
        conn.execute('INSERT INTO memory(user_id,role,content,created_at) VALUES(?,?,?,?)',(uid,'user',user_msg,date.today().isoformat()))
        conn.execute('INSERT INTO memory(user_id,role,content,created_at) VALUES(?,?,?,?)',(uid,'assistant',ai_msg,date.today().isoformat()))
        conn.commit()

    def log_message(self, format, *args):
        print(f'[{self.log_date_time_string()}] {args[0]}')


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    print(f'健身AI助手 网页版: http://0.0.0.0:{port}')
    HTTPServer(('0.0.0.0', port), Handler).serve_forever()
