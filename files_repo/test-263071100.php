<?php
$name = $_GET['name'] ?? '';
?>
<!DOCTYPE html>
<html>
<body>
    <h1>欢迎, <?php echo $name; ?></h1>  <!-- 直接输出未过滤的数据 -->
</body>
</html>