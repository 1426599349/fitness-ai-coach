"""
MCP 定时任务管理。
Demo阶段用线程模拟定时器，实际部署可替换为 Celery/APScheduler。
"""
import threading
import time
from datetime import date
from .orchestrator import orchestrator


class Scheduler:
    """定时任务调度器"""

    def __init__(self):
        self._tasks: dict[str, threading.Timer] = {}
        self._running = False

    def schedule_daily_meal(self, user_id: str, hour: int = 6, minute: int = 0):
        """
        每日定时生成饮食。
        实际部署用 cron，Demo用一次性延时模拟。
        """
        task_id = f"daily_meal:{user_id}"
        today = date.today().isoformat()
        print(f"[Scheduler] 触发每日饮食生成: user={user_id}, date={today}")
        result = orchestrator.daily_meal_flow(user_id, today)
        return result

    def schedule_weekly_checkin(self, user_id: str):
        """
        每周定时回访。
        实际部署每周一上午10点触发，Demo直接调用。
        """
        task_id = f"weekly_checkin:{user_id}"
        print(f"[Scheduler] 触发每周回访: user={user_id}")
        # 需要用户输入新体重，这里只做标记
        return {
            'triggered': True,
            'user_id': user_id,
            'message': '请更新您的最新体重数据',
        }

    def trigger_daily_for_all(self, user_ids: list[str]) -> dict:
        """批量触发所有用户的每日饮食生成"""
        results = {}
        for uid in user_ids:
            results[uid] = self.schedule_daily_meal(uid)
        return results

    def stop(self):
        self._running = False
        for t in self._tasks.values():
            t.cancel()
        self._tasks.clear()


scheduler = Scheduler()
