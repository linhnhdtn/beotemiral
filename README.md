# Task Harbor

Ứng dụng desktop Linux để gom terminal, task và AI agent vào một không gian làm việc. Giao diện tiếng Việt, nền tối; terminal tương tác thật, hoạt động ngay cả khi bạn chuyển tab hoặc đóng cửa sổ chính.

## Chạy và đóng gói

### Cài bằng file `.deb` (Ubuntu/Debian, x86_64)

Đóng gói bằng `npm run dist:deb`. File tạo ra là `release/deb/Task-Harbor-0.1.5-amd64.deb`; thư mục build riêng để không ghi đè bản AppImage/unpacked đang chạy.

```bash
sudo apt install ./release/deb/Task-Harbor-0.1.5-amd64.deb
```

Gói cài chứa ứng dụng, Electron, terminal native, icon và menu **Task Harbor**. Máy nhận không cần Node.js/npm hoặc thư mục mã nguồn. Ứng dụng được cài vào `/opt/Task Harbor`, có lệnh `task-harbor` và tự thiết lập sandbox/AppArmor bằng script chuẩn của electron-builder. Việc cài không tự mở ứng dụng. Sau khi hoàn tất các task cũ, thoát hoàn toàn rồi mở lại bản đã cài bằng `task-harbor` hoặc menu. Dữ liệu vẫn dùng `~/.config/Task Harbor`.

Nếu từng dùng `npm run install:desktop`, shortcut cá nhân sẽ che menu của gói `.deb`. **Sau khi cài `.deb` thành công**, đổi tên hai shortcut cũ để giữ bản sao:

```bash
mv ~/.local/share/applications/dev.taskharbor.desktop ~/.local/share/applications/dev.taskharbor.desktop.bak
mv "$(xdg-user-dir DESKTOP)/Task Harbor.desktop" "$(xdg-user-dir DESKTOP)/Task Harbor.desktop.bak"
```

Sau đó mở từ menu ứng dụng; có thể ghim lại vào dock. Bỏ qua bước đổi tên nếu không có shortcut cũ. Cập nhật bằng cách cài file `.deb` phiên bản mới; gỡ bằng `sudo apt remove task-harbor` (giữ dữ liệu cá nhân).

### Chạy từ mã nguồn / AppImage

Cần Node.js 22.12 trở lên, npm, Linux có giao diện đồ họa, shell tương thích Bash/Zsh và bộ công cụ biên dịch C/C++ cùng Python 3 để xây `node-pty`. Electron cần các thư viện hệ thống GTK, NSS, ALSA và GBM; máy Linux desktop thường đã có chúng.

```bash
npm install
npm run dev
```

`dev` và `start` kiểm tra và tải bộ chạy Electron nếu còn thiếu; lần tải đầu cần kết nối mạng. Dev server dùng cổng `5187`.

`postinstall` tự xây lại `node-pty` theo phiên bản Electron. Nếu đổi Electron hoặc gặp lỗi native module ABI, chạy `npm run postinstall`.

```bash
npm run build
npm start
npm run dist
```

AppImage nằm tại `release/0.1.5/Task-Harbor-0.1.5-x86_64.AppImage`:

```bash
chmod +x release/0.1.5/Task-Harbor-0.1.5-x86_64.AppImage
./release/0.1.5/Task-Harbor-0.1.5-x86_64.AppImage
```

AppImage dùng FUSE 2. Trên máy Ubuntu hiện tại thiếu FUSE, Chromium bị chặn user namespace và chưa có SUID sandbox hợp lệ. Có thể chạy bản phát triển với `npm run dev -- --noSandbox`, bản build với `npm start -- --noSandbox`, hoặc dùng thư mục đóng gói sẵn không cần FUSE:

```bash
./release/0.1.5/linux-unpacked/task-harbor --no-sandbox
```

Nếu chỉ có AppImage, chuyển vào thư mục bạn muốn giải nén, chạy `/đường/dẫn/Task-Harbor-0.1.5-x86_64.AppImage --appimage-extract`, sau đó mở `./squashfs-root/AppRun --no-sandbox`. Runtime AppImage đi kèm không hỗ trợ `--appimage-extract-and-run`.

`--no-sandbox` chỉ là cách chạy tùy chọn cho môi trường này, làm tắt sandbox Chromium. Mặc định ứng dụng vẫn bật sandbox; preload cô lập và renderer không có quyền Node.js trực tiếp.

## Sử dụng

Để thêm biểu tượng trên desktop và mục **Task Harbor** trong menu ứng dụng:

```bash
npm run install:desktop -- --no-sandbox
```

Lệnh trên phù hợp với máy Ubuntu hiện tại và không tự mở ứng dụng. Máy hỗ trợ sandbox Chromium có thể bỏ `-- --no-sandbox`. Sau đó nhấn **Super**, tìm **Task Harbor** và bấm mở, hoặc bấm đúp biểu tượng trên desktop. Muốn ghim vào dock, bấm chuột phải biểu tượng trong menu và chọn **Add to Favorites / Thêm vào yêu thích**.

Bản 0.1.5 được đóng gói riêng để không ghi đè ứng dụng đang chạy. Sau khi cập nhật shortcut, hãy tự thoát hoàn toàn và mở lại khi các task hiện tại đã xong để nhận phiên bản mới.

Shortcut trỏ tới `release/0.1.5/linux-unpacked/task-harbor`; giữ nguyên thư mục dự án. Nếu chuyển dự án sang vị trí khác, chạy lại lệnh cài shortcut.

- Tạo nhóm, đặt tên/màu và sắp xếp thứ tự trong thanh bên. Mỗi nhóm có bộ đếm phiên; trạng thái đang chạy hiển thị ở từng terminal. Khi xóa nhóm có phiên, chọn nhóm nhận để giữ nguyên tiến trình; nếu xóa nhóm cuối, ứng dụng tạo lại “Không gian chung”.
- Tạo terminal với tên task và thư mục làm việc; để trống lệnh để mở shell, hoặc nhập lệnh cần chạy. Chọn loại **AI agent** để nhận diện các CLI agent đã cài và đăng nhập trên máy.
- Lưu mẫu lệnh để mở lại nhanh; nút bút chì ở mỗi terminal mở đầy đủ tên, loại phiên, nhóm, thư mục và lệnh khởi chạy. Nếu phiên đang chạy, thư mục/lệnh mới được lưu cho lần chạy tiếp theo; ứng dụng không tự dừng task hiện tại.
- Chọn một phiên từ tổng quan để mở terminal; dùng cây nhóm/terminal bên trái hoặc chia đôi màn hình để làm việc cùng lúc với hai phiên. Trong lúc ứng dụng đang mở, mỗi nhóm nhớ terminal và khung chia đôi gần nhất: chuyển nhóm rồi quay lại sẽ mở đúng phiên, giữ lệnh đang gõ và tiến trình đang chạy. Nhóm chưa từng mở chọn phiên đầu tiên; nhóm trống hiện tổng quan. Nút **Tất cả phiên** vẫn mở danh sách tổng quan.
- **Tách cửa sổ** giữ nguyên tiến trình và màn hình terminal. Đóng cửa sổ riêng đưa phiên về cửa sổ chính.
- Đóng cửa sổ chính giữ các task chạy nền. Mở lại từ tray hoặc chạy ứng dụng lần nữa; chỉ một bản ứng dụng quản lý workspace.
- Nếu desktop không có tray, chạy lại ứng dụng để hiện cửa sổ cũ. Có thể kiểm tra chế độ này bằng `TASK_HARBOR_NO_TRAY=1 npm start`.
- Nút nguồn ở thanh bên hoặc menu tray **Thoát hoàn toàn** dừng các phiên cùng tiến trình con; ứng dụng hỏi xác nhận nếu còn phiên chạy. **Dừng phiên** cũng hỏi xác nhận trước khi kết thúc task.

| Phím tắt | Thao tác |
| --- | --- |
| `Ctrl+Shift+T` | Tạo terminal |
| `Ctrl+Shift+P` | Tìm và chuyển đến phiên |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Phiên tiếp theo / trước |
| `↑` / `↓`, `←` / `→` trong cây | Chọn mục, thu/mở nhóm |
| `Alt+↑` / `Alt+↓` trong cây | Di chuyển nhóm hoặc terminal |
| `F2` trong cây | Sửa nhóm hoặc terminal |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Sao chép vùng chọn / dán terminal |
| `Ctrl+C` | Gửi ngắt đến lệnh trong terminal |
| `Ctrl+Shift+Q` | Thoát hoàn toàn |

Trạng thái có biểu tượng và chữ: đang khởi động, đang chạy, đã kết thúc, đã dừng hoặc lỗi. Phiên chạy lệnh theo vòng đời lệnh và có exit code; shell tương tác theo vòng đời shell. Nhãn AI agent không suy đoán tiến độ hay trạng thái chờ trả lời của agent. Bản này chưa nhập các terminal đã mở bên ngoài hoặc tự điều phối agent.

## Cây nhóm và chỉnh sửa terminal

Thanh bên hiển thị nhóm ở cấp đầu, terminal/AI agent nằm bên dưới. Bấm mũi tên để thu gọn hoặc mở nhóm; terminal đang hiển thị và tiến trình vẫn giữ nguyên. Trạng thái thu/mở và thứ tự được lưu khi khởi động lại.

Kéo nhóm lên/xuống để sắp xếp. Kéo terminal vào nhóm nhận hoặc trước/sau một terminal khác; vạch sáng chỉ vị trí sẽ chèn. Các nút mũi tên xuất hiện ngay trên dòng đang trỏ/chọn, giúp đổi thứ tự mà vẫn nhìn thấy danh sách. Nút bút chì sửa phiên, nút **+** tạo terminal trong nhóm.

## Nhập / Xuất cấu hình

Mở **Nhập / Xuất cấu hình** ở thanh bên. **Xuất cấu hình** lưu nhóm, thông tin khởi chạy và mẫu lệnh thành JSON. **Chọn file JSON** nhận file đã xuất hoặc `workspace.json` của bản cũ; xem trước nhóm, tên phiên, thư mục và lệnh rồi bấm **Nhập cấu hình**.

Import thêm các nhóm và phiên với ID mới, giữ nguyên dữ liệu và task hiện có. Các phiên nhập vào ở trạng thái dừng; chọn phiên rồi **Chạy lại** để bắt đầu. Không nhập PID, trạng thái chạy hay lịch sử đầu ra từ file. Giới hạn mỗi file: 5 MB, 200 nhóm, 2.000 phiên và 500 mẫu lệnh. Chức năng này nhập cấu hình đã lưu, chưa tiếp quản terminal đang mở trong ứng dụng khác.

## Hiệu năng khi chạy nhiều phiên

Các terminal dùng chung một lần quét tiến trình mỗi 300 ms. Khi dừng phiên, ứng dụng vẫn quét mới để tìm tiến trình con và kiểm tra danh tính PID; dừng phiên này không ảnh hưởng phiên khác. Danh sách theo dõi cũng loại bỏ các tiến trình con đã kết thúc.

Đo lại bằng `npm run benchmark:sessions -- 20`. Lệnh này chạy 20 terminal thử nghiệm trong thư mục tạm bằng runtime Node của Electron, không mở cửa sổ hoặc dùng workspace cá nhân. Phép đo 6 giây trên máy phát triển ghi nhận số lần quét giảm từ 400 xuống 20; CPU tiến trình quản lý từ 38,03% xuống 5,58%. Đây là phép đo terminal nhàn rỗi, không bao gồm renderer và CPU của lệnh/agent; kết quả thay đổi theo máy và tải hệ thống.

## Nền trong suốt

Bấm **Giao diện** trên thanh trên cùng, kéo **Độ trong suốt nền** từ 0–100%. Mặc định **70% trong suốt** (nền còn 30% độ đậm); 0% là nền đặc. Nút **Mặc định 70%** đưa về mức ban đầu. Chỉ nền thay đổi; chữ, con trỏ và nội dung terminal vẫn giữ nguyên độ rõ.

Mức đã chọn được lưu cùng workspace, áp dụng cho cả cửa sổ chính và terminal tách riêng. Thay đổi có hiệu lực ngay, không khởi động lại terminal hoặc lệnh đang chạy. Workspace của các bản cũ tự nhận mặc định 70% mà vẫn giữ nguyên nhóm và cấu hình phiên.

## Lưu dữ liệu và khôi phục

Nhóm, mẫu, thông tin phiên và bố cục lưu trong `workspace.json` ở thư mục Electron `userData`, mặc định `$XDG_CONFIG_HOME/Task Harbor` hoặc `~/.config/Task Harbor`. Có thể đặt thư mục riêng bằng `TASK_HARBOR_DATA_DIR=/đường/dẫn/tuyệt/đối`.

Tệp được ghi qua tệp tạm rồi đổi tên, với quyền tệp `0600`. Nếu cấu hình hỏng hoặc không hợp lệ, ứng dụng giữ bản cũ thành `workspace.json.corrupt-<timestamp>` và hiển thị cảnh báo. Khi khôi phục thủ công, thoát hoàn toàn trước, sao lưu thư mục dữ liệu, rồi sửa/thay `workspace.json` bằng bản hợp lệ.

Sau khi khởi động lại, phiên trước đó đang chạy được đánh dấu đã dừng; lệnh chỉ chạy khi bạn chủ động chạy lại. Đầu ra terminal nằm trong bộ nhớ, giới hạn khoảng 5.000 dòng cuộn mỗi phiên, và không lưu qua lần thoát ứng dụng. Không bảo đảm task tiếp tục sau khi app crash, bị buộc dừng hoặc máy khởi động lại. Lệnh và đường dẫn trong cấu hình được lưu dạng văn bản; không đặt mật khẩu trực tiếp trong mẫu lệnh.

## Kiến trúc và kiểm thử

Electron main quản lý PTY (`node-pty`), cây tiến trình Linux, workspace và cửa sổ. React chỉ giao tiếp qua API preload có kiểu dữ liệu và IPC được kiểm tra đầu vào. `xterm.js` hiển thị terminal; `@xterm/headless` giữ trạng thái ANSI và lịch sử để chuyển phiên, chia đôi hay tách cửa sổ mà không khởi động lại task. Mỗi snapshot có số thứ tự để renderer ghép đúng với luồng đầu ra tiếp theo.

```bash
npm run typecheck
npm test
npm run test:sessions
npm run test:e2e
npm run dist
npm run test:packaged
```

Các kiểm thử lưu trữ dùng Node test runner, bao gồm chỉnh sửa/sắp xếp phiên, lưu trạng thái cây, kiểm tra và nhập/xuất cấu hình. Playwright kiểm tra kéo thả bằng chuột, phím tắt cây, sửa phiên đang chạy và dùng cấu hình mới khi chạy lại, giữ nguyên PID khi thu/mở nhóm, xem trước import, không tự chạy lệnh và xuất/nhập lại file. Kiểm thử phiên chạy PTY thật dưới Node runtime của Electron để đúng native ABI: Unicode, màu ANSI, `Ctrl+C`, resize, lịch sử giới hạn, mã thoát, thư mục/shell lỗi, dừng tiến trình con, chạy lại/xóa, khôi phục không tự chạy và mười phiên trong ba nhóm. Kiểm thử giao diện dùng Playwright khởi chạy Electron; cần màn hình desktop hoặc `xvfb-run -a npm run test:e2e` trong CI.

`test:packaged` giải nén AppImage vào thư mục tạm, kiểm tra PTY, nhập tiếng Việt, thoát và mở lại từ tray nếu desktop có StatusNotifierWatcher. Các bài kiểm thử Electron dùng `--no-sandbox` để tương thích với máy kiểm thử hiện tại; mã sản phẩm không tự tắt sandbox.

`npm run test:deb` thực hiện cùng kiểm thử trên file `.deb` đã giải nén, không cài gói vào hệ thống. Dùng `TASK_HARBOR_NO_TRAY=1 xvfb-run -a npm run test:deb` để chạy trong màn hình ảo, tránh mở cửa sổ trên desktop đang làm việc.

Các lệnh người dùng chạy có quyền của tài khoản Linux hiện tại. Ứng dụng hoạt động cục bộ, không yêu cầu máy chủ hoặc tài khoản riêng.
