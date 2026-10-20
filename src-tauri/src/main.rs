// Windows release derlemesinde ek konsol penceresi açılmasın
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    atak_rdm_lib::run()
}
