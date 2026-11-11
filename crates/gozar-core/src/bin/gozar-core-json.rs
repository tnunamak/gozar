//! Native JSONL transport; deliberately separate from the IO-free library.
use std::io::{self, BufRead, Write};
fn main() -> io::Result<()> {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    for line in io::stdin().lock().lines() {
        writeln!(output, "{}", gozar_core::step(&line?))?;
        output.flush()?;
    }
    Ok(())
}
