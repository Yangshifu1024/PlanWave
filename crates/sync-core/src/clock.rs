//! Lamport 逻辑时钟：为每个设备上产生的 op 提供单调递增的偏序戳。
//!
//! 正确性不依赖 Lamport 戳（全序由服务端 `seq` 保证），
//! 它只用于客户端拉取远端 op 后推进自己的时钟，保证跨设备时钟不回退。

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LamportClock {
    counter: u64,
}

impl LamportClock {
    pub fn new() -> Self {
        Self { counter: 0 }
    }

    /// 本地产生新 op 前调用：时钟 +1 并返回新值。
    pub fn tick(&mut self) -> u64 {
        self.counter += 1;
        self.counter
    }

    /// 观察到远端时钟（来自拉取/推送响应）后调用：取 max，保证不回退。
    pub fn observe(&mut self, remote: u64) {
        self.counter = self.counter.max(remote);
    }

    pub fn now(&self) -> u64 {
        self.counter
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_is_monotonic() {
        let mut c = LamportClock::new();
        assert_eq!(c.tick(), 1);
        assert_eq!(c.tick(), 2);
        assert_eq!(c.tick(), 3);
    }

    #[test]
    fn observe_never_goes_backwards() {
        let mut c = LamportClock::new();
        c.tick();
        c.tick();
        assert_eq!(c.now(), 2);
        c.observe(100);
        assert_eq!(c.now(), 100);
        c.observe(1);
        assert_eq!(c.now(), 100);
        assert_eq!(c.tick(), 101);
    }

    #[test]
    fn two_devices_converge_after_sync() {
        let mut a = LamportClock::new();
        let mut b = LamportClock::new();
        a.tick();
        a.tick();
        b.tick();
        // b 从 a 拉到 lamport=2 的 op
        b.observe(2);
        assert_eq!(b.tick(), 3);
        // a 从 b 拉到 lamport=3 的 op
        a.observe(3);
        assert_eq!(a.tick(), 4);
    }
}
