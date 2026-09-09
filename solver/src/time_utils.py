def clock(hour: int, minute: int) -> int:
   """Convert HH:MM to minutes after midnight."""
   return hour * 60 + minute


def display_time(value: int) -> str:
   """Convert minutes after midnight to HH:MM."""
   return f"{value // 60:02d}:{value % 60:02d}"
