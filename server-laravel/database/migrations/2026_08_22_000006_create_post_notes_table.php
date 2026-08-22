<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up()
    {
        Schema::create('post_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('post_id')->constrained('scheduled_posts')->onDelete('cascade');
            $table->foreignId('user_id')->nullable()->constrained('users')->onDelete('set null');
            $table->text('message');
            $table->json('mentioned_user_ids')->nullable();
            $table->timestamps();
        });
    }

    public function down()
    {
        Schema::dropIfExists('post_notes');
    }
};
